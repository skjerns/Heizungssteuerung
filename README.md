# Heizungssteuerung
This is my Heizungssteuerung, to control my radiator remotely. Probably not useful for anyone but me.

## Configuration
This project uses a `config.json` file for configuration. A sample file is provided as `config.json.sample`.

Create a `config.json` file and fill in the following values:

```json
{
    "value_file_path": "/path/to/value/file",
    "thermostat_mac_address": "00:1A:22:00:00:00",
    "remote_secret": "a_very_secret_string",
    "remote_ssh_key": "/path/to/your/ssh/key",
    "remote_target_user": "user",
    "remote_target_ip": "192.168.1.100",
    "control_script_path": "/path/to/control.py"
}
```

### Options

* `value_file_path`: Path to the file that stores the desired thermostat value.
* `thermostat_mac_address`: The MAC address of your EQ3 bluetooth thermostat.
* `remote_secret`: A secret string used to authenticate the remote `sleep` command.
* `remote_ssh_key`: Path to the SSH key used to connect to the remote machine for the `sleep` command.
* `remote_target_user`: The username for the SSH connection for the `sleep` command.
* `remote_target_ip`: The IP address of the remote machine for the `sleep` command.
* `control_script_path`: Absolute path to the `control.py` script.

### Telegram
The `control.py` script uses `telegram_send` to send notifications. You need to configure it separately. See the `telegram-send` documentation for instructions.
