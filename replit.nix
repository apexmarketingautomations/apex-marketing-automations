{pkgs}: {
  deps = [
    pkgs.gtk3
    pkgs.alsa-lib
    pkgs.libdrm
    pkgs.mesa
    pkgs.cairo
    pkgs.pango
    pkgs.at-spi2-core
    pkgs.expat
    pkgs.dbus
    pkgs.cups
    pkgs.xorg.libxcb
    pkgs.xorg.libXrandr
    pkgs.xorg.libXfixes
    pkgs.xorg.libXext
    pkgs.xorg.libXdamage
    pkgs.xorg.libXcomposite
    pkgs.xorg.libX11
    pkgs.nss
    pkgs.nspr
    pkgs.glib
  ];
}
