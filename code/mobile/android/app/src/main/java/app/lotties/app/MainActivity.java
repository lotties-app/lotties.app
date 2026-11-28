package app.lotties.app;

import android.os.Bundle;
import app.lotties.app.shared.LottiesSharedPlugin;
import app.lotties.app.speech.LottiesSpeechPlugin;
import app.lotties.app.voice.LottiesVoicePlugin;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // App-local plugins are registered before the bridge starts (super.onCreate).
        registerPlugin(LottiesSharedPlugin.class);
        registerPlugin(LottiesVoicePlugin.class);
        // The voice lab's recogniser (spike branch feat/voice-lab only, docs/design/49a-voice-lab.md).
        registerPlugin(LottiesSpeechPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
