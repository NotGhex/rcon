# rcon

Rcon client for node.js

```js
import { RconClient } from '@catplusplus/rcon';

const client = new RconClient({
    host: 'localhost',
    port: 25575,
    password: 'password'
});

client.on('ready', async () => {
    const packet = await client.sendCommand('help');
    console.log(packet.body);
});

client.login();
```