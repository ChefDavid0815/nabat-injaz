using Microsoft.UI.Xaml;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media;
using Nabat.Core;
using System.Text.Json;
using Windows.System;
namespace Nabat.Windows;

public sealed partial class MainWindow : Window
{
    private readonly string _data = App.DataDirectory;
    private readonly LocalStore _store;
    private readonly CredentialVault _vault;
    private ApiClient? _api; private SyncEngine? _sync; private OperationsSnapshot? _snapshot;
    private string _org = "", _section = "Home"; private bool _ready, _refreshing;
    private readonly DispatcherTimer _timer = new() { Interval = TimeSpan.FromSeconds(30) };
    private string? _sessionId; private HashSet<string> _sessionPlants = [];
    private string? _pendingPlantCode;
    public MainWindow()
    {
        Directory.CreateDirectory(_data); _store = App.Services.GetRequiredService<LocalStore>(); _vault = new(Path.Combine(_data, "session.dpapi"));
        InitializeComponent(); Title = "NABAT Operations 1.1"; ExtendsContentIntoTitleBar = true; SetTitleBar(TitleBar);
        AppWindow.Resize(new global::Windows.Graphics.SizeInt32(1536, 1024)); SystemBackdrop = new MicaBackdrop();
        HeaderGrid.SizeChanged += (_, _) => { if (HeaderGrid.ActualWidth < 850) { if (HeaderGrid.RowDefinitions.Count == 0) { HeaderGrid.RowDefinitions.Add(new() { Height = GridLength.Auto }); HeaderGrid.RowDefinitions.Add(new() { Height = GridLength.Auto }); } Grid.SetColumn(HeaderCommands, 0); Grid.SetRow(HeaderCommands, 1); Grid.SetColumnSpan(HeaderCommands, 2); } else { HeaderGrid.RowDefinitions.Clear(); Grid.SetColumn(HeaderCommands, 1); Grid.SetRow(HeaderCommands, 0); Grid.SetColumnSpan(HeaderCommands, 1); } };
        AddShortcut(VirtualKey.K, VirtualKeyModifiers.Control, () => _ = CommandPalette());
        AddShortcut(VirtualKey.F, VirtualKeyModifiers.Control, () => Navigate("Plants"));
        AddShortcut(VirtualKey.T, VirtualKeyModifiers.Control | VirtualKeyModifiers.Shift, () => Navigate("Today"));
        AddShortcut(VirtualKey.A, VirtualKeyModifiers.Control | VirtualKeyModifiers.Shift, () => Navigate("Alerts"));
        AddShortcut((VirtualKey)188, VirtualKeyModifiers.Control, () => Navigate("Settings"));
        AddShortcut(VirtualKey.N, VirtualKeyModifiers.Control, () => _ = NewPlant());
        _timer.Tick += async (_, _) => await RefreshAsync(_section is "Home" or "Today" or "Alerts");
        Navigation.DisplayModeChanged += (_, e) => AccountFooter.Visibility = e.DisplayMode == NavigationViewDisplayMode.Expanded ? Visibility.Visible : Visibility.Collapsed; Closed += (_, _) => { _timer.Stop(); };
    }
    private void AddShortcut(VirtualKey key, VirtualKeyModifiers modifiers, Action action) { var accelerator = new KeyboardAccelerator { Key = key, Modifiers = modifiers }; accelerator.Invoked += (_, e) => { action(); e.Handled = true; }; Root.KeyboardAccelerators.Add(accelerator); }
    private async void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (_ready) return; _ready = true; await _store.InitializeAsync(); var localePreference = await _store.PreferenceAsync("rtl"); ApplyLocale(localePreference is null ? System.Globalization.CultureInfo.InstalledUICulture.TwoLetterISOLanguageName == "ar" : localePreference == "True"); await BootSystems();
        if (Environment.GetEnvironmentVariable("NABAT_UI_PROBE_DIR") is { Length: > 0 } probe) { if (Environment.GetEnvironmentVariable("NABAT_UI_PROBE_CLOUD") is { Length: > 0 } cloud) await RunCloudProbe(probe, cloud); else if (Environment.GetEnvironmentVariable("NABAT_UI_PROBE_RESUME") == "1") await RunResumeProbe(probe); else await RunRenderProbe(probe); return; }
        var saved = _vault.Load();
        if (saved is null) { ShowSignIn(); return; }
        Connect(saved.BaseUrl, saved.Session); _org = await _store.PreferenceAsync($"org:{saved.Session.Actor.Id}") ?? saved.Session.Workspaces.FirstOrDefault()?.Id ?? "";
        if (!saved.Session.Workspaces.Any(w => w.Id == _org)) _org = saved.Session.Workspaces.FirstOrDefault()?.Id ?? "";
        if (string.IsNullOrEmpty(_org)) { await EnsureWorkspace(); }
        await RestoreBounds(); _section = await _store.PreferenceAsync($"section:{_api!.Scope(_org)}") ?? "Home";
        var cache = await _store.ReadCacheAsync(_api!.Scope(_org)); if (cache is not null) { _snapshot = OperationsSnapshot.Parse(cache); BindWorkspace(); Navigate(_section); }
        await RefreshAsync(); _timer.Start();
    }
    private void Connect(string url, ApiSession session)
    {
        if (_api is not null) { foreach (var window in App.Windows.Where(w => !ReferenceEquals(w, this)).ToList()) window.Close(); _windowContexts.Clear(); _restoredWindows = false; }
        _api?.Dispose(); _api = new(url) { Session = session }; _sync = new(_api, _store);
        _sync.Changed += (_, _) => DispatcherQueue.TryEnqueue(() => SyncText.Text = _sync.Status);
    }
    private void ShowSignIn()
    {
        PageTitle.Text = "Welcome to Operations"; ScopeText.Text = "Sign in with your NABAT account."; MaintenanceButton.IsEnabled = false;
        var url = new TextBox { Header = "NABAT server", Text = Environment.GetEnvironmentVariable("NABAT_API_URL") ?? _api?.BaseUri.ToString() ?? "http://127.0.0.1:3001", MinWidth = 380 };
        var email = new TextBox { Header = "Email", PlaceholderText = "you@organisation.com" }; var password = new PasswordBox { Header = "Password" };
        var signIn = NativeUi.Button("Sign in", async (button, _) =>
        {
            ((Button)button).IsEnabled = false;
            try
            {
                var api = new ApiClient(url.Text); var session = await api.SignInAsync(email.Text, password.Password); api.Dispose();
                Connect(url.Text, session); _vault.Save(url.Text, session); _org = session.Workspaces.FirstOrDefault()?.Id ?? "";
                if (_org.Length == 0) await EnsureWorkspace();
                await _store.SetPreferenceAsync($"org:{session.Actor.Id}", _org); await RefreshAsync(); _timer.Start(); password.Password = "";
            }
            catch (Exception ex) { Message(ex.Message, true); }
            finally { ((Button)button).IsEnabled = true; }
        });
        var demo = NativeUi.Button("Open local demo", async (_, _) =>
        {
            url.Text = "http://127.0.0.1:3001"; email.Text = "owner@nabat.demo"; password.Password = "NabatDemo2026!";
            try { var api = new ApiClient(url.Text); var session = await api.SignInAsync(email.Text, password.Password); api.Dispose(); Connect(url.Text, session); _vault.Save(url.Text, session); _org = session.Workspaces[0].Id; await RefreshAsync(); _timer.Start(); password.Password = ""; } catch (Exception ex) { Message(ex.Message, true); }
        });
        SetView(NativeUi.Panel(NativeUi.Stack(NativeUi.Text("Your organisation, ready for care.", 26, true), url, email, password, signIn, demo, NativeUi.Caption("Local demo uses synthetic plants. Start the Operations development server first."))));
    }
    private async Task RefreshAsync(bool redraw = true)
    {
        if (_api?.Session is null || _org.Length == 0 || _refreshing) return;
        _refreshing = true; var client = _api; var sync = _sync!; var organisation = _org; var scope = client.Scope(organisation);
        bool Current() => ReferenceEquals(client, _api) && organisation == _org && client.Session is not null;
        try
        {
            if (sync.WorkingOffline) { if (_snapshot is null) Message("Connect once to cache your workspace."); return; }
            await sync.SyncAsync(organisation); await client.PostAsync($"{organisation}/queue/reconcile", new { });
            var json = await client.GetAsync($"{organisation}/snapshot"); if (!Current()) return;
            var snapshot = OperationsSnapshot.Parse(json);
            if (snapshot.Workspace.Id != organisation || snapshot.Actor.Id != client.Session!.Actor.Id) throw new InvalidDataException("The workspace identity changed. Sign in again.");
            _snapshot = snapshot; await _store.SaveCacheAsync(scope, json); if (!Current()) return;
            var ownedSession = snapshot.Sessions.FirstOrDefault(s => s.Status == "active" && s.OwnerId == client.Session!.Actor.Id);
            if (ownedSession is null) { _sessionId = null; _sessionPlants.Clear(); }
            else if (_sessionId != ownedSession.Id)
            {
                using var detail = JsonDocument.Parse(await client.GetAsync($"{organisation}/sessions/{ownedSession.Id}")); if (!Current()) return;
                _sessionId = ownedSession.Id; _sessionPlants = detail.RootElement.GetProperty("plants").EnumerateArray().Select(p => p.GetProperty("plant_id").GetString()!).ToHashSet();
            }
            _ = CacheImages(snapshot, scope); await RestoreWindows(); if (!Current()) return;
            BindWorkspace(); if (redraw || ViewHost.Children.Count == 0) Navigate(_section); Notice.IsOpen = false;
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or ApiException)
        {
            if (!Current()) return;
            Message(ex is ApiException { Status: 401 } ? "Session expired. Sign in again; your local care is preserved." : "Working offline. Cached workspace remains available; care will sync when the connection returns.", ex is ApiException { Status: 401 });
            SyncText.Text = "Offline · local work preserved"; if (_snapshot is null) ShowSignIn();
        }
        catch (Exception ex) { if (Current()) Message(ex.Message, true); }
        finally
        {
            _refreshing = false;
            if (!Current() && _api?.Session is not null && _org.Length > 0) _ = RefreshAsync();
            else if (_pendingPlantCode is { } code && _snapshot is not null) { _pendingPlantCode = null; OpenProtocol("nabat://plant/" + code); }
        }
    }
    private bool CanManage => _snapshot?.Workspace.Role is "owner" or "admin" or "manager";
    private void BindWorkspace() { PresentationCulture.Timezone = _snapshot!.Workspace.Timezone; UpdateSystems(); WorkspaceButton.Content = _snapshot!.Workspace.Name; ScopeText.Text = _snapshot.Workspace.Name; AccountName.Text = _snapshot.Actor.Name; MaintenanceButton.IsEnabled = _snapshot.Workspace.Role != "viewer"; LastUpdated.Text = "Updated " + NativeUi.Date(_snapshot.ServerTime, _snapshot.Workspace.Timezone); foreach (var item in Navigation.MenuItems.OfType<NavigationViewItem>()) if (item.Tag.ToString() == "Tags") item.IsEnabled = CanManage; }
    private void SetView(UIElement content) { ViewHost.Children.Clear(); ViewHost.Children.Add(content); if (content is FrameworkElement element) element.Loaded += (_, _) => LocaleService.Apply(element); }
    private void Message(string text, bool error = false) { Notice.Title = error ? "Action needs attention" : "Workspace status"; Notice.Message = text; Notice.Severity = error ? InfoBarSeverity.Warning : InfoBarSeverity.Informational; Notice.IsOpen = true; }
    private async void OnNavigationChanged(NavigationView sender, NavigationViewSelectionChangedEventArgs args) { if (args.SelectedItem is NavigationViewItem item && _snapshot is not null) { _section = item.Tag.ToString()!; await _store.SetPreferenceAsync($"section:{_api!.Scope(_org)}", _section); RenderSection(); } }
    private void Navigate(string section) { _section = section; var item = Navigation.MenuItems.OfType<NavigationViewItem>().FirstOrDefault(i => i.Tag.ToString() == section); if (item is not null && !ReferenceEquals(Navigation.SelectedItem, item)) Navigation.SelectedItem = item; else RenderSection(); }
    private void RenderSection() { if (_snapshot is null) return; PageTitle.Text = LocaleService.T(_section == "Home" ? "Operations Home" : _section); ScopeText.Text = _snapshot.Workspace.Name; switch (_section) { case "Home": ShowHome(); break; case "Today": ShowToday(); break; case "Plants": ShowPlants(); break; case "Settings": ShowSettings(); break; case "Locations": ShowLocations(); break; case "Team": ShowTeam(); break; case "Alerts": ShowAlerts(); break; case "Analytics": ShowAnalytics(); break; case "Tags": ShowTags(); break; } }
    private async void ChooseWorkspace(object sender, RoutedEventArgs e) { if (_api?.Session is null) return; var choices = new ComboBox { ItemsSource = _api.Session.Workspaces, DisplayMemberPath = "Name", SelectedIndex = _api.Session.Workspaces.FindIndex(w => w.Id == _org), MinWidth = 320 }; var dialog = new ContentDialog { XamlRoot = Root.XamlRoot, Title = "Operational workspace", Content = choices, PrimaryButtonText = "Open workspace", CloseButtonText = "Cancel" }; if (await dialog.ShowAsync() != ContentDialogResult.Primary) return; var selected = (Workspace)choices.SelectedItem; _org = selected.Id; _sessionId = null; _sessionPlants.Clear(); await _store.SetPreferenceAsync($"org:{_api.Session.Actor.Id}", _org); var cache = await _store.ReadCacheAsync(_api.Scope(_org)); _snapshot = cache is null ? null : OperationsSnapshot.Parse(cache); SetView(NativeUi.Text("Loading workspace…")); await RefreshAsync(); }
    private async void OpenCommands(object sender, RoutedEventArgs e) => await CommandPalette();
    private async void StartMaintenance(object sender, RoutedEventArgs e) => await StartMaintenanceAsync();
    private void OpenPlant(PlantSummary plant) { if (_api is null || _sync is null || _snapshot is null) return; var window = new PlantWindow(_api, _store, _sync, _org, plant, _sessionPlants.Contains(plant.Id) ? _sessionId : null, _snapshot.Workspace.Role != "viewer", CanManage); TrackContext(window, "plant", plant.Id); App.Windows.Add(window); window.Closed += async (_, _) => { App.Windows.Remove(window); await RefreshAsync(); }; window.Activate(); }
    public async void OpenProtocol(string value)
    {
        var link = PlantDeepLink.Parse(value); if (link is null) { Message("Plant link is invalid.", true); return; }
        if (_api?.Session is null || _refreshing || _snapshot is null) { _pendingPlantCode = link.PlantCode; return; }
        try
        {
            var cached = _snapshot.Plants.FirstOrDefault(p => p.Code.Equals(link.PlantCode, StringComparison.OrdinalIgnoreCase));
            if (cached is not null) { OpenPlant(cached); return; }
            using var identity = JsonDocument.Parse(await _api.GetAsync("identity/" + Uri.EscapeDataString(link.PlantCode)));
            var organisation = identity.RootElement.GetProperty("organisation_id").GetString()!;
            if (organisation != _org)
            {
                _org = organisation; _snapshot = null; _sessionId = null; _sessionPlants.Clear(); _pendingPlantCode = link.PlantCode;
                await _store.SetPreferenceAsync($"org:{_api.Session.Actor.Id}", _org); await RefreshAsync(); return;
            }
            using var details = JsonDocument.Parse(await _api.GetAsync($"{_org}/plants/{identity.RootElement.GetProperty("id")}"));
            OpenPlant(Contracts.Read<PlantSummary>(details.RootElement.GetProperty("plant")));
        }
        catch (Exception ex) { Message(ex.Message, true); }
    }
}
