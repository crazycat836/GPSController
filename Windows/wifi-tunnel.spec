# -*- mode: python ; coding: utf-8 -*-
# PyInstaller spec for the standalone wifi_tunnel helper (Python 3.13).
# Build: py -3.13 -m PyInstaller wifi-tunnel.spec --noconfirm

from PyInstaller.utils.hooks import collect_all

pmd_datas, pmd_binaries, pmd_hiddenimports = collect_all('pymobiledevice3')
pytun_datas, pytun_binaries, pytun_hidden = collect_all('pytun_pmd3')

a = Analysis(
    ['wifi_tunnel.py'],
    pathex=['.'],
    binaries=[*pmd_binaries, *pytun_binaries],
    datas=[*pmd_datas, *pytun_datas],
    hiddenimports=[*pmd_hiddenimports, *pytun_hidden],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=['tkinter', 'matplotlib', 'PIL', 'numpy', 'scipy', 'pandas'],
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='wifi-tunnel',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,
    disable_windowed_traceback=False,
    uac_admin=True,   # tunnel needs admin to create TUN iface
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name='wifi-tunnel',
)
