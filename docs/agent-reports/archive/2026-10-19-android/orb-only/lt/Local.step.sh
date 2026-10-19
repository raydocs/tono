source apps/android/supply-chain/sing-box/sing-box.pin
mkdir -p "$RUNNER_TEMP/sb" "$RUNNER_TEMP/local-tunnel"
curl --fail --location --retry 3 -o "$RUNNER_TEMP/sb/sb.tgz" \
  "https://github.com/SagerNet/sing-box/releases/download/$SING_BOX_TAG/$SING_BOX_LINUX_AMD64_ASSET"
echo "$SING_BOX_LINUX_AMD64_SHA256  $RUNNER_TEMP/sb/sb.tgz" | sha256sum --check
tar -xzf "$RUNNER_TEMP/sb/sb.tgz" -C "$RUNNER_TEMP/sb"
sudo ip addr add 198.20.0.10/32 dev lo
sudo ip addr add 198.20.0.11/32 dev lo
sudo iptables -I OUTPUT -d 198.20.0.10,198.20.0.11 ! -o lo -j REJECT
nohup python3 apps/android/scripts/local-tunnel/fixture-servers.py serve \
  "$RUNNER_TEMP/sb/sing-box-$SING_BOX_VERSION-linux-amd64/sing-box" "$RUNNER_TEMP/local-tunnel" \
  > "$RUNNER_TEMP/local-tunnel/serve.out" 2>&1 &
for i in $(seq 30); do curl -fs http://127.0.0.1:28080/healthz && break; sleep 1; done
cat "$RUNNER_TEMP/local-tunnel/serve.out"
echo "LOCAL_TUNNEL=$RUNNER_TEMP/local-tunnel" >> "$GITHUB_ENV"
