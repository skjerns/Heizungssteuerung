#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Created on Thu Nov  9 16:52:39 2023

@author: simon
"""
import os
import time
import telegram_send
from datetime import datetime, timedelta
from functools import wraps
import traceback
from pathlib import Path
import argparse
import json

import eq3bt
from eq3bt import Mode
from eq3bt.connection import BTLEConnection


def escape(text):
    """
    Replaces the following chars in `text` ('&' with '&amp;', '<' with '&lt;' and '>' with '&gt;').

    :param text: the text to escape
    :return: the escaped text
    """
    chars = {"&": "&amp;", "<": "&lt;", ">": "&gt;"}
    if text is None:
        return None
    for old, new in chars.items():
        text = text.replace(old, new)
    return text

#%% SETTINGS


pwd = os.path.dirname(__file__)
config_file = Path(f'{pwd}/config.json')
with open(config_file) as f:
    config = json.load(f)

#%% CODE

def log(msg):
    datestr = datetime.now().strftime('%y-%m-%d %H:%M:%S')
    with open(f'{pwd}/eq3_control.log', 'a') as f:
        writestr = f'\n[{datestr}] {msg}'
        f.write(writestr)

def forward_exception(func):
    @wraps(func)
    def wrapped(*args, **kwargs):
        try:
            return func(*args, **kwargs)
        except Exception as e:
            tb = traceback.format_exc()
            print("SENDING STACK VIA TELEGRAM")
            msg = escape(f'Thermostat set Error: ```\n{e}: {repr(e)}</code>\n<code>{tb}\n```')
            print('---\n', tb, '\n---\nMSG:\n\n', msg, '\n---')

            telegram_send.send(messages = [msg])
            raise e
    return wrapped


@forward_exception
def connect_thermostat():
    thermostat = eq3bt.Thermostat(config['thermostat_mac_address'],
                                  connection_cls=BTLEConnection)

    retries = 3
    last_exception = None
    for attempt in range(retries):
        try:
            thermostat.update()
        except eq3bt.BackendException as e:
            last_exception = e
            log(f"Bluetooth command failed on attempt {attempt + 1}/{retries}: {e}")
            if attempt < retries - 1:
                # On the second attempt (index 1), restart bluetooth.
                if attempt == 1:
                    log("Second attempt failed. Restarting Bluetooth adapter...")
                    os.system('hciconfig hci0 down')
                    time.sleep(2)
                    os.system('hciconfig hci0 up')
                    time.sleep(5)
                else: # first attempt failed
                    log("First attempt failed. Retrying in 5 seconds...")
                    time.sleep(5)

    if last_exception:
        raise last_exception

    return thermostat


@forward_exception
def set_thermostat(thermostat, value):

    # for safety, strip
    value = value.strip()

    if value=='away':
        # I'm away and wifi is not connected: turn off heating and set manual
        end_date = datetime.now() + timedelta(weeks=12)
        thermostat.set_away(end_date, thermostat.eco_temperature)
        requested = f'away=> {thermostat.eco_temperature}'
    elif value=='home':
        # I'm home but wifi is not connected: turn on heating but manual
        thermostat.set_mode(Mode.Auto)
        requested = f'home=> {thermostat.comfort_temperature}'
    else:
        try:
            value_float = round(float(value)*2)/2
            thermostat.target_temperature = value_float
            requested = f'manual => value={value_float}'
        except ValueError:
            requested = f'ERROR, value={value}, unknown'


    telegram_send.send(messages=[escape(f'{str(thermostat)} // requested={requested}')])
    log(f'{str(thermostat)} // requested={requested}')
    
    timestamp = datetime.now().strftime('%Y-%m-%d %H:%M')
    with open(config['eq3_temperature_csv'], 'a') as f:
        f.write(f'{timestamp}, {value}\n')
        
    return # Success



if __name__=='__main__':
    parser = argparse.ArgumentParser(description='Control EQ3 Bluetooth thermostat.')
    group = parser.add_mutually_exclusive_group()
    group.add_argument('--get_temperature', action='store_true', help='Get current thermostat status (default).')
    group.add_argument('--set_temperature', type=float, help='Set target temperature.')

    args = parser.parse_args()

    thermostat = connect_thermostat()

    if args.get_temperature:
        print(thermostat.target_temperature)

    if args.set_temperature is not None:
        set_thermostat(thermostat, str(args.set_temperature))

    if args.set_temperature is None and not args.get_temperature:
        timestamp = datetime.now().strftime('%Y-%m-%d %H:%M')
        print(f'{timestamp}, {thermostat.target_temperature}')
