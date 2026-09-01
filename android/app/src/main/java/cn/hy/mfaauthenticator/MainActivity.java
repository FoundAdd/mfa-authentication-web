package cn.hy.mfaauthenticator;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(AppUpdateInstaller.class);
        super.onCreate(savedInstanceState);
    }
}
