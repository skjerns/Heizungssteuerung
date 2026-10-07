#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Control the Shelly BLU TRV through the Shelly BLU Gateway Gen3 (bluetooth dongle).

The gateway exposes the paired TRV as component `blutrv:<id>` on its local
RPC API, so no bluetooth stack is needed on this machine.

@author: simon
"""
import os
import time
import json
import argparse
import traceback
import urllib.request
from pathlib import Path
from functools import wraps
from datetime import datetime

import telegram_send


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


pwd = os.path.dirname(os.path.abspath(__file__))
config_file = Path(f'{pwd}/config.json')
with open(config_file) as f:
    config = json.load(f)

gateway_host = config['trv_gateway_host']
trv_id = int(config.get('trv_id', 200))

# allowed target range of the BLU TRV
MIN_TEMP, MAX_TEMP = 4.0, 30.0

#%% CODE

def log(msg):
    datestr = datetime.now().strftime('%y-%m-%d %H:%M:%S')
    with open(f'{pwd}/trv_control.log', 'a') as f:
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


def rpc(method, params, retries=3):
    """POST an RPC call to the gateway, retrying since the TRV is reached over BLE."""
    url = f'http://{gateway_host}/rpc/{method}'
    data = json.dumps(params).encode()
    last_exception = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, data=data,
                                         headers={'Content-Type': 'application/json'})
            with urllib.request.urlopen(req, timeout=30) as resp:
                return json.loads(resp.read() or 'null')
        except Exception as e:
            # the gateway answers RPC errors with HTTP 4xx/5xx and a JSON body
            if hasattr(e, 'read'):
                e = RuntimeError(f'{method} failed: {e} {e.read().decode(errors="replace")}')
            last_exception = e
            log(f"RPC {method} failed on attempt {attempt + 1}/{retries}: {e}")
            if attempt < retries - 1:
                time.sleep(5)
    raise last_exception


@forward_exception
def get_status():
    """Status of the TRV as cached by the gateway (target_C, current_C, pos, ...)."""
    status = rpc('BluTrv.GetStatus', {'id': trv_id})
    if not status.get('connected', False):
        log(f'TRV not connected: {status}')
    return status


def describe(status):
    return (f'[TRV {trv_id}] Target {status.get("target_C")} '
            f'(current: {status.get("current_C")}, valve: {status.get("pos")}%, '
            f'battery: {status.get("battery")}%)')


@forward_exception
def set_thermostat(value):

    # for safety, strip
    value = value.strip()

    try:
        value_float = round(float(value)*2)/2
        value_float = min(max(value_float, MIN_TEMP), MAX_TEMP)
    except ValueError:
        value_float = None
        requested = f'ERROR, value={value}, unknown'

    if value_float is not None:
        rpc('BluTrv.Call', {'id': trv_id, 'method': 'TRV.SetTarget',
                            'params': {'id': 0, 'target_C': value_float}})
        requested = f'manual => value={value_float}'

    status = get_status()
    telegram_send.send(messages=[escape(f'{describe(status)} // requested={requested}')])
    log(f'{describe(status)} // requested={requested}')

    return # Success



if __name__=='__main__':
    parser = argparse.ArgumentParser(description='Control Shelly BLU TRV via the BLU Gateway.')
    group = parser.add_mutually_exclusive_group()
    group.add_argument('--get_temperature', action='store_true', help='Get current target temperature.')
    group.add_argument('--set_temperature', type=float, help='Set target temperature.')

    args = parser.parse_args()

    if args.set_temperature is not None:
        set_thermostat(str(args.set_temperature))
    else:
        status = get_status()
        if args.get_temperature:
            print(status['target_C'])
        else:
            timestamp = datetime.now().strftime('%Y-%m-%d %H:%M')
            print(f'{timestamp}, {status["target_C"]}')
