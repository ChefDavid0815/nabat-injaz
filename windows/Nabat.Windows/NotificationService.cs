using Microsoft.Windows.AppNotifications;
using Microsoft.Windows.AppNotifications.Builder;
namespace Nabat.Windows;

public interface INotificationService : IDisposable { void Enable(bool enabled); void Show(string code, string summary); event EventHandler<string>? Activated; }
public sealed class NotificationService : INotificationService
{
    private bool _registered; public event EventHandler<string>? Activated;
    public void Enable(bool enabled) { if (enabled == _registered) return; if (enabled) { AppNotificationManager.Default.NotificationInvoked += Invoked; AppNotificationManager.Default.Register(); _registered = true; } else { AppNotificationManager.Default.Unregister(); AppNotificationManager.Default.NotificationInvoked -= Invoked; _registered = false; } }
    private void Invoked(AppNotificationManager sender, AppNotificationActivatedEventArgs args) { if (args.Arguments.TryGetValue("plant", out var code)) Activated?.Invoke(this, "nabat://plant/" + code); }
    public void Show(string code, string summary) { if (!_registered) return; var notification = new AppNotificationBuilder().AddArgument("plant", code).AddText("NABAT").AddText(summary).BuildNotification(); AppNotificationManager.Default.Show(notification); }
    public void Dispose() => Enable(false);
}
