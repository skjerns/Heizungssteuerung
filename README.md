# Heizungssteuerung
This is my Heizungssteuerung, to control my radiator remotely. Probably not useful for anyone but me.

## Configuration
This project uses a `config.json` file for configuration. A sample file is provided as `config.json.sample`.

Create a `config.json` file and fill in the following values:

```json
{
    "trv_gateway_host": "192.168.0.95",
    "trv_id": 200,
    "control_script_path": "/path/to/trv_control.py",
    "wol_mac": "00:00:00:00:00:00",
    "wol_broadcast": "192.168.0.255"
}
```

### Options

* `trv_gateway_host`: IP of the Shelly BLU Gateway Gen3 the Shelly BLU TRV is paired with.
* `trv_id`: Component id of the TRV on the gateway (`blutrv:<id>`, see `/rpc/Shelly.GetComponents`).
* `control_script_path`: Absolute path to the `trv_control.py` script.
* `wol_mac`: MAC address of the machine to wake via the `?wol` endpoint.
* `wol_broadcast`: Broadcast address used to send the Wake-on-LAN magic packet.

### Telegram
The `trv_control.py` script uses `telegram_send` to send notifications. You need to configure it separately. See the `telegram-send` documentation for instructions.
