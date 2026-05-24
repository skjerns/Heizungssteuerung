# Heizungssteuerung
This is my Heizungssteuerung, to control my radiator remotely. Probably not useful for anyone but me.

## Configuration
This project uses a `config.json` file for configuration. A sample file is provided as `config.json.sample`.

Create a `config.json` file and fill in the following values:

```json
{
    "thermostat_mac_address": "00:1A:22:00:00:00",
    "control_script_path": "/path/to/control.py",
    "room_temperature_csv": "/path/to/room_temp.csv",
    "eq3_temperature_csv": "/path/to/eq3_temp.csv",
    "wol_mac": "00:00:00:00:00:00",
    "wol_broadcast": "192.168.0.255"
}
```

### Options

* `thermostat_mac_address`: The MAC address of the EQ3 bluetooth thermostat.
* `control_script_path`: Absolute path to the `eq3_control.py` script.
* `room_temperature_csv`: Path to the CSV log of measured room temperatures.
* `eq3_temperature_csv`: Path to the CSV log of thermostat target temperatures.
* `wol_mac`: MAC address of the machine to wake via the `?wol` endpoint.
* `wol_broadcast`: Broadcast address used to send the Wake-on-LAN magic packet.

### Telegram
The `eq3_control.py` script uses `telegram_send` to send notifications. You need to configure it separately. See the `telegram-send` documentation for instructions.
