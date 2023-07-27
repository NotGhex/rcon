import { TypedEmitter } from 'fallout-utility/TypedEmitter';
import { Socket, createConnection } from 'net';

export interface RconClientEvents {
    packet: [packet: RconPacket];
    raw: [packet: Buffer];
    error: [error: Error];
    ready: [];
    close: [];
}

export interface RconClientOptions {
    host: string;
    /**
     * @default 25577
     */
    port?: number;
    password: string;
}

export enum RconPacketType {
    RESPONSE = 0,
    CMD_EXEC = 2,
    AUTH = 3,
    AUTH_FAILED = -1
}

export interface RconPacket {
    type: RconPacketType;
    id: number;
    body: string;
    size: number;
}

export type RconPacketResolvable<OptionalSize extends boolean = true> = Buffer|(OptionalSize extends true ? Omit<RconPacket, 'size'> : RconPacket);

export class RconClient extends TypedEmitter<RconClientEvents> {
    readonly host: string;
    readonly port: number;
    readonly password: string;

    public socket?: Socket;
    public authenticated: boolean = false;

    get ready() { return this.authenticated && !this.socket?.destroyed; }

    constructor(options: RconClientOptions) {
        super();

        this.host = options.host;
        this.port = options.port ?? 25575;
        this.password = options.password;
    }

    public async login(): Promise<this> {
        if (this.ready) throw new Error('Client is already authenticated');
        this.socket = createConnection({
            host: this.host,
            port: this.port
        });

        await new Promise((res) => this.socket?.on('connect', res));

        this.socket.on('data', data => this.emitPacket(data));
        this.socket.on('error', err => this.emit('error', err));
        this.socket.on('close', () => this.destroy());
        this.socket.on('end', () => this.destroy());

        const authId = 10;
        const packet = await this.sendPacket(RconClient.encodePacket({
            type: RconPacketType.AUTH,
            id: authId,
            body: this.password
        }));

        if (packet.id === RconPacketType.AUTH_FAILED) throw new Error('Authentication failed');

        this.authenticated = true;
        this.emit('ready');

        return this;
    }

    public destroy(): void {
        if (!this.socket?.destroyed) this.socket?.destroy();
        this.authenticated = false;
        this.socket?.removeAllListeners();
        this.emit('close');
    }

    public async sendCommand(cmd: string): Promise<RconPacket> {
        return await this.sendPacket(RconClient.encodePacket({
            type: RconPacketType.CMD_EXEC,
            id: 30,
            body: cmd
        }));
    }

    public async sendPacket(packet: Buffer): Promise<RconPacket> {
        const decodedPacket = RconClient.resolvePacket(packet, 'decode');

        return new Promise((res, rej) => {
            this.socket!.once('data', data => {
                const dataPacket = RconClient.decodePacket(data);
                if (dataPacket.id !== decodedPacket.id) return rej(new Error('Received invalid authentication packet', { cause: packet }));

                res(dataPacket);
            });

            this.socket!.write(packet);
        });
    }

    private emitPacket(packet: RconPacketResolvable<false>): void {
        this.emit('packet', RconClient.resolvePacket(packet, 'decode'));
        this.emit('raw', RconClient.resolvePacket(packet, 'encode'));
    }

    public static resolvePacket(packet: RconPacketResolvable, action: 'encode'): Buffer;
    public static resolvePacket(packet: RconPacketResolvable<false>, action: 'decode'): RconPacket;
    public static resolvePacket(packet: RconPacketResolvable<false>, action: 'encode'|'decode'): Buffer|RconPacket {
        switch (action) {
            case 'encode': return packet instanceof Buffer ? packet : this.encodePacket(packet);
            case 'decode': return packet instanceof Buffer ? this.decodePacket(packet) : packet;
        }
    }

    public static encodePacket(data: Omit<RconPacket, 'size'>): Buffer {
        const size = Buffer.byteLength(data.body) + 14;
        const packet = Buffer.alloc(size);

        packet.writeInt32LE(size - 4, 0);
        packet.writeInt32LE(data.id, 4);
        packet.writeInt32LE(data.type, 8);
        packet.write(data.body, 12, size - 2, "ascii");
        packet.writeInt16LE(0, size - 2);

        return packet;
    }

    public static decodePacket(packet: Buffer): RconPacket {
        return {
            type: packet.readInt32LE(8),
            id: packet.readInt32LE(4),
            body: packet.toString("ascii", 12, packet.length - 2),
            size: packet.readInt32LE(0),
        };
    }
}
