import broadlink, base64, sys, time

HOST = '192.168.1.23'
dev = None

def connect():
    global dev
    try:
        dev = broadlink.hello(HOST)
        dev.auth()
        print('READY', flush=True)
    except Exception as e:
        print(f'ERR connect: {e}', flush=True)
        dev = None

connect()

count = 0
for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    try:
        if dev is None:
            connect()
        count += 1
        t0 = time.time()
        dev.send_data(base64.b64decode(line))
        print(f'IR #{count} sent in {int((time.time()-t0)*1000)}ms', flush=True)
    except Exception as e:
        print(f'ERR: {e}', flush=True)
        dev = None
        connect()
