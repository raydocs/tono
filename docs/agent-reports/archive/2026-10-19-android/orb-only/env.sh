export JAVA_HOME=$(ls -d /home/user/.tono-tools/jdk-2* 2>/dev/null | head -1)
[ -z "$JAVA_HOME" ] && export JAVA_HOME=/home/user/.tono-tools/jdk-17
export ANDROID_HOME=/home/user/.android-sdk ANDROID_SDK_ROOT=/home/user/.android-sdk
export PATH=$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$PATH
