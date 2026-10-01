#!/bin/bash
cd /workspace/merge-work
touch /tmp/mgr2.stop
for i in $(seq 1 100); do ps -eo args | grep -q "^python3 bin/mgr2.py" || break; sleep 3; done
rm -f /tmp/mgr2.stop
setsid nohup python3 bin/mgr2.py >> mgr2.log 2>&1 &
echo "$(date +%T) mgr2 restarted"
