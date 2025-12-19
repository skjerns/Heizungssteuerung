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

import json

pwd = os.path.dirname(__file__)
config_file = Path(f'{pwd}/config.json')
with open(config_file) as f:
    config = json.load(f)
value_file = Path(config['value_file_path'])
status_file = Path(f'{pwd}/status.txt')

if not status_file.exists():
    status_file.write_text('NONE')

#%% CODE

def log(msg):
    datestr = datetime.now().strftime('%y-%m-%d %H:%M:%S')
    with open(f'{pwd}/control.log', 'a') as f:
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
def set_thermostat(value):
    thermostat = eq3bt.Thermostat(config['thermostat_mac_address'], connection_cls=BTLEConnection)

    # for safety, strip
    value = value.strip()

    retries = 3
    last_exception = None
    for attempt in range(retries):
        try:
            thermostat.update()

            if value=='away':
                # I'm away and wifi is not connected: turn off heating and set manual
                end_date = datetime.now() + timedelta(weeks=12)
                thermostat.set_away(end_date, thermostat.eco_temperature)
                requested = f'away=> {thermostat.eco_temperature}'
            elif value=='home':
                # I'm home but wifi is not connected: turn on heating but manual
                thermostat.set_mode(Mode.Auto)
                requested = f'home=> {thermostat.comfort_temperature}'
            elif value.replace('.', '', 1).isdigit():
                value_float = round(float(value)*2)/2
                thermostat.target_temperature = value_float
                requested = f'manual => value={value_float}'
            else:
                requested = f'ERROR, value={value}, unknown'

            telegram_send.send(messages=[escape(f'{str(thermostat)} // requested={requested}')])
            log(f'{str(thermostat)} // requested={requested}')
            return # Success

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

#%%
@forward_exception
def main():
    prev_value = status_file.read_text().strip()
    value = value_file.read_text().strip()

    #if value==prev_value:
     #   # nothing happened. stay put.
      #  log(f'{value=}, no change')
    #else:
    set_thermostat(value)
    status_file.write_text(value)

if __name__=='__main__':
    main()
