using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Printing;
using global::Windows.Graphics.Printing;
namespace Nabat.Windows;

public sealed class TagPrinting : IDisposable
{
    private readonly Window _window; private readonly Func<ImageSource?> _image; private readonly PrintManager _manager; private readonly PrintDocument _document = new(); private UIElement? _page;
    private readonly double _width, _height;
    public TagPrinting(Window window, Func<ImageSource?> image, double width = 45, double height = 65) { _window = window; _image = image; _width = width; _height = height; _manager = PrintManagerInterop.GetForWindow(WinRT.Interop.WindowNative.GetWindowHandle(window)); _manager.PrintTaskRequested += Requested; _document.Paginate += Paginate; _document.GetPreviewPage += Preview; _document.AddPages += Add; }
    public async Task ShowAsync() { if (!PrintManager.IsSupported()) throw new InvalidOperationException("Windows printing is unavailable."); await PrintManagerInterop.ShowPrintUIForWindowAsync(WinRT.Interop.WindowNative.GetWindowHandle(_window)); }
    private void Requested(PrintManager sender, PrintTaskRequestedEventArgs args) => args.Request.CreatePrintTask("NABAT identity tag", source => source.SetSource(_document.DocumentSource));
    private void Paginate(object sender, PaginateEventArgs args) { var description = ((PrintTaskOptions)args.PrintTaskOptions).GetPageDescription(0); var image = new Image { Source = _image(), Width = _width / 25.4 * 96, Height = _height / 25.4 * 96, Stretch = Stretch.Uniform, HorizontalAlignment = HorizontalAlignment.Left, VerticalAlignment = VerticalAlignment.Top, Margin = new(_width >= 200 ? 0 : 48) }; _page = new Grid { Width = description.PageSize.Width, Height = description.PageSize.Height, Background = NativeUi.Brush("#FFFFFF"), Children = { image } }; _document.SetPreviewPageCount(1, PreviewPageCountType.Final); }
    private void Preview(object sender, GetPreviewPageEventArgs args) { if (_page is not null) _document.SetPreviewPage(1, _page); }
    private void Add(object sender, AddPagesEventArgs args) { if (_page is not null) _document.AddPage(_page); _document.AddPagesComplete(); }
    public void Dispose() { _manager.PrintTaskRequested -= Requested; _document.Paginate -= Paginate; _document.GetPreviewPage -= Preview; _document.AddPages -= Add; }
}
