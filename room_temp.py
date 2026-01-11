import os
import glob
import time
import csv
from datetime import datetime

os.system('modprobe w1-gpio')
os.system('modprobe w1-therm')

base_dir = '/sys/bus/w1/devices/'
device_folders = glob.glob(base_dir + '28*')

if not device_folders:
    raise RuntimeError("No DS18B20 sensor found.")

device_file = device_folders[0] + '/w1_slave'
csv_file = '/home/pi/temperature_log.csv'

def read_temp_raw():
    """Read raw lines from the 1-wire device file."""
    try:
        with open(device_file, 'r') as f:
            return f.readlines()
    except FileNotFoundError:
        return None

def read_temp_celsius(max_retries=10):
    """Parse data with a retry limit and return only Celsius."""
    retries = 0
    lines = read_temp_raw()
    
    while (not lines or lines[0].strip()[-3:] != 'YES') and retries < max_retries:
        time.sleep(0.2)
        lines = read_temp_raw()
        retries += 1
    
    if retries >= max_retries or not lines:
        return None
        
    equals_pos = lines[1].find('t=')
    if equals_pos != -1:
        temp_string = lines[1][equals_pos+2:]
        return float(temp_string) / 1000.0
    return None

def log_temperature(filename):
    """Read temperature and append timestamped Celsius to CSV."""
    temp_c = read_temp_celsius()
    
    if temp_c is None:
        return

    timestamp = datetime.now().strftime('%Y-%m-%d %H:%M')
    file_exists = os.path.isfile(filename)
    
    with open(filename, 'a', newline='') as f:
        writer = csv.writer(f)
        if not file_exists:
            writer.writerow(['Timestamp', 'Celsius'])
        writer.writerow([timestamp, f'{temp_c:.1f}'])
    with open('temperature_last.txt', 'w') as f:
        f.write(f'{temp_c:.1f}')
log_temperature(csv_file)
