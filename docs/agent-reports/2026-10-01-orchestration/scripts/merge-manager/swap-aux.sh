#!/bin/bash
cd /workspace/merge-work; touch /tmp/aux2.stop
for i in $(seq 1 100); do ps -eo args | grep -q "^/bin/bash bin/aux3.sh" || break; sleep 3; done
rm -f /tmp/aux2.stop; setsid nohup bin/aux3b.sh >> aux.log 2>&1 &
echo "$(date +%T) aux3b started"
