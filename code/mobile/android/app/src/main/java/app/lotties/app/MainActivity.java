package app.lotties.app;

import android.os.Bundle;
import app.lotties.app.shared.LottiesSharedPlugin;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // App-local plugins are registered before the bridge starts (super.onCreate).
        registerPlugin(LottiesSharedPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
