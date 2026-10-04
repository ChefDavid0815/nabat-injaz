using Microsoft.UI.Xaml;
using Microsoft.Windows.AppLifecycle;
using global::Windows.ApplicationModel.Activation;
using Microsoft.Extensions.DependencyInjection;
using Nabat.Core;
namespace Nabat.Windows;

public partial class App : Application
{
    public static string DataDirectory { get; } = Environment.GetEnvironmentVariable("NABAT_UI_PROBE_DIR") is { Length: > 0 } probe ? Path.Combine(Path.GetFullPath(probe), ".state") : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "NABAT", "Operations");
    public static IServiceProvider Services { get; } = CreateServices();
    private static IServiceProvider CreateServices() { var root = DataDirectory; Directory.CreateDirectory(root); return new ServiceCollection().AddSingleton(new LocalStore(Path.Combine(root, "operations.db"))).AddSingleton<ITelemetryService>(new LocalTelemetry(Path.Combine(root, "telemetry.jsonl"))).AddSingleton<INotificationService, NotificationService>().BuildServiceProvider(); }
    public static List<Window> Windows { get; } = [];
    public App() { InitializeComponent(); Services.GetRequiredService<ITelemetryService>().Record("startup"); UnhandledException += (_, e) => { Services.GetRequiredService<ITelemetryService>().Record("crash", new { type = e.Exception.GetType().Name }); if (Environment.GetEnvironmentVariable("NABAT_UI_PROBE_DIR") is { Length: > 0 } probe) { Directory.CreateDirectory(probe); File.WriteAllText(Path.Combine(probe,"startup-error.txt"),e.Exception.ToString()); } }; }
    protected override async void OnLaunched(Microsoft.UI.Xaml.LaunchActivatedEventArgs args)
    {
        var activation = AppInstance.GetCurrent().GetActivatedEventArgs(); var instance = AppInstance.FindOrRegisterForKey(Environment.GetEnvironmentVariable("NABAT_UI_PROBE_DIR") is null ? "NABAT.Operations" : "NABAT.Operations.UIProbe");
        if (!instance.IsCurrent) { await instance.RedirectActivationToAsync(activation); Exit(); return; }
        var window = new MainWindow(); Windows.Add(window); window.Closed += (_, _) => Windows.Remove(window);
        void Activate(AppActivationArguments data) { window.Activate(); if (data.Kind == ExtendedActivationKind.Protocol && data.Data is IProtocolActivatedEventArgs protocol) window.OpenProtocol(protocol.Uri.AbsoluteUri); }
        instance.Activated += (_, data) => window.DispatcherQueue.TryEnqueue(() => Activate(data)); window.Activate(); Activate(activation);
        var commandLink = Environment.GetCommandLineArgs().FirstOrDefault(v => v.StartsWith("nabat://", StringComparison.OrdinalIgnoreCase)); if (commandLink is not null) window.OpenProtocol(commandLink);
    }
}
