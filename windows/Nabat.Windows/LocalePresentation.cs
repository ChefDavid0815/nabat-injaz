using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
namespace Nabat.Windows;

public sealed partial class MainWindow
{
    private void ApplyLocale(bool arabic)
    {
        LocaleService.Set(arabic); Root.Language = arabic ? "ar-AE" : "en-GB"; Root.FlowDirection = arabic ? FlowDirection.RightToLeft : FlowDirection.LeftToRight;
        foreach (var item in Navigation.MenuItems.OfType<NavigationViewItem>()) item.Content = LocaleService.T(item.Tag.ToString()!);
        SearchCommandButton.Content = LocaleService.T("Search or command   Ctrl+K"); MaintenanceButton.Content = LocaleService.T("Start maintenance"); PageTitle.Text = LocaleService.T(_section == "Home" ? "Operations Home" : _section);
    }
}
