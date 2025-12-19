<?php
if (isset($_GET['value']) && !empty($_GET['value'])) {

    $parameterValue = $_GET['value'];
    $config = json_decode(file_get_contents('config.json'), true);
    $filePath = $config['value_file_path'];

    $fileHandle = fopen($filePath, 'w') or die("Unable to open file!");
    fwrite($fileHandle, $parameterValue . "\n");
    fclose($fileHandle);

    // timestamp
    exec('sh -c "printf \'[%s] \' \"$(date \'+%Y-%m-%d %H:%M:%S\')\" >> /tmp/control.log"');

    // python call
    $controlScript = $config['control_script_path'];
    exec('sh -c "/usr/bin/python3 ' . $controlScript . ' >> /tmp/control.log 2>&1 &"');

} else {
    echo "unclear value for key.";
}
?>
