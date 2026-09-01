package cn.hy.mfaauthenticator;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;

/**
 * 应用内更新:JS 侧将 Release APK 下载到应用缓存目录后调用本插件,
 * 通过 FileProvider 调起系统安装器完成升级。
 */
@CapacitorPlugin(name = "AppUpdateInstaller")
public class AppUpdateInstaller extends Plugin {

    @PluginMethod
    public void installApk(PluginCall call) {
        String path = call.getString("path");
        if (path == null || path.contains("/") || path.contains("\\") || path.contains("..")) {
            call.reject("Invalid APK path");
            return;
        }
        File apk = new File(getContext().getCacheDir(), path);
        if (!apk.isFile()) {
            call.reject("APK not downloaded: " + path);
            return;
        }
        if (getActivity() == null) {
            call.reject("Activity unavailable");
            return;
        }
        // Android 8+ 需要用户授予本应用"安装未知应用"权限;
        // 跳转系统设置引导开启,返回后由用户重试安装
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                && !getActivity().getPackageManager().canRequestPackageInstalls()) {
            try {
                Intent settingsIntent = new Intent(
                        Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                        Uri.parse("package:" + getActivity().getPackageName()));
                getActivity().startActivity(settingsIntent);
            } catch (ActivityNotFoundException ignored) {
                // 个别 ROM 裁剪了该设置页,直接尝试安装
            }
            JSObject result = new JSObject();
            result.put("status", "permission_required");
            call.resolve(result);
            return;
        }
        Uri uri = FileProvider.getUriForFile(
                getContext(), getContext().getPackageName() + ".fileprovider", apk);
        Intent intent = new Intent(Intent.ACTION_VIEW);
        intent.setDataAndType(uri, "application/vnd.android.package-archive");
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_GRANT_READ_URI_PERMISSION);
        try {
            getActivity().startActivity(intent);
        } catch (ActivityNotFoundException e) {
            call.reject("No installer available");
            return;
        }
        JSObject result = new JSObject();
        result.put("status", "started");
        call.resolve(result);
    }
}
