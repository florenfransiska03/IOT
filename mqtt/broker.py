import asyncio
from amqtt.broker import Broker

config = {
    "listeners": {
        "default": {"type": "tcp", "bind": "0.0.0.0:1883"},
        "ws": {"type": "ws", "bind": "0.0.0.0:9001"},
    },
    "auth": {"allow-anonymous": True},
}

async def main():
    await Broker(config).start()
    await asyncio.Event().wait()

asyncio.run(main())