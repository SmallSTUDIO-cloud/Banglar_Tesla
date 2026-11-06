namespace BanglarTesla.Domain
{
    public static class SafeAreaCalculator
    {
        /// <summary>Converts Unity's bottom-left screen safe area to UI Toolkit's top-left logical panel coordinates.</summary>
        public static LogicalRect ToLogicalPanel(LogicalRect screenPixels, LogicalRect safeAreaPixels, LogicalRect panelLogical)
        {
            if (screenPixels.Width <= 0.0 || screenPixels.Height <= 0.0 || panelLogical.Width <= 0.0 || panelLogical.Height <= 0.0)
                return panelLogical;
            double left = (safeAreaPixels.X - screenPixels.X) / screenPixels.Width * panelLogical.Width + panelLogical.X;
            double top = (screenPixels.Bottom - safeAreaPixels.Bottom) / screenPixels.Height * panelLogical.Height + panelLogical.Y;
            double right = (safeAreaPixels.Right - screenPixels.X) / screenPixels.Width * panelLogical.Width + panelLogical.X;
            double bottom = (screenPixels.Bottom - safeAreaPixels.Y) / screenPixels.Height * panelLogical.Height + panelLogical.Y;
            left = Numerics.Clamp(left, panelLogical.X, panelLogical.Right);
            top = Numerics.Clamp(top, panelLogical.Y, panelLogical.Bottom);
            right = Numerics.Clamp(right, left, panelLogical.Right);
            bottom = Numerics.Clamp(bottom, top, panelLogical.Bottom);
            return new LogicalRect(left, top, right - left, bottom - top);
        }
    }
}
