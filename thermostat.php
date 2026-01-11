<?php
$config = json_decode(file_get_contents('config.json'), true);
$controlScriptPath = $config['control_script_path'];

if (isset($_GET['get'])) {
    // Construct the shell command to get temperature
    $command = '/usr/bin/python3 ' . $controlScriptPath . ' --get_temperature';

    // Execute the command and capture the output
    $output = shell_exec($command);

    // Print the output
    echo $output;

} elseif (isset($_GET['set']) && !empty($_GET['set'])) {
    $parameterValue = $_GET['set'];

    // Construct the shell command to set temperature
    $command = '/usr/bin/python3 ' . $controlScriptPath . ' --set_temperature ' . escapeshellarg($parameterValue);

    // Execute the command in the background
    exec('sh -c "' . $command . ' >> /tmp/control.log 2>&1 &"');

    echo "Request to set temperature to " . $parameterValue . " received.";
} else {
    echo "unclear value for key.";
}
?>