<?php
if (isset($_GET['value']) && !empty($_GET['value'])) {
    $parameterValue = $_GET['value'];

    $config = json_decode(file_get_contents('config.json'), true);
    $controlScriptPath = $config['control_script_path'];

    // Construct the shell command
    $command = '/usr/bin/python3 ' . $controlScriptPath . ' --set_temperature ' . escapeshellarg($parameterValue);

    // Execute the command in the background
    exec('sh -c "' . $command . ' >> /tmp/control.log 2>&1 &"');

    echo "Request to set temperature to " . $parameterValue . " received.";
} else {
    echo "unclear value for key.";
}
?>
