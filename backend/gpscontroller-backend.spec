# -*- mode: python ; coding: utf-8 -*-
# PyInstaller spec for GPSController backend (Python 3.13).
# Build: py -3.13 -m PyInstaller backend/gpscontroller-backend.spec --noconfirm

from PyInstaller.utils.hooks import collect_all, collect_submodules, copy_metadata

# pymobiledevice3 has a LOT of dynamic imports — collect everything
pmd_datas, pmd_binaries, pmd_hiddenimports = collect_all('pymobiledevice3')

# pytun_pmd3 ships wintun.dll as a data file that ctypes loads at runtime
pytun_datas, pytun_binaries, pytun_hidden = collect_all('pytun_pmd3')

# developer_disk_image is an indirect dependency of pymobiledevice3 (imported
# at the top of services/mobile_image_mounter.py). PyInstaller doesn't pick
# it up via collect_all('pymobiledevice3'), so previously the bundled exe
# would fail to import mobile_image_mounter and silently skip DDI mount.
# That broke iOS <17 users (e.g. iPhone 8 Plus / iOS 16.7) — DtSimulateLocation
# accepts the call but iOS rejects it without DDI.
ddi_datas, ddi_binaries, ddi_hidden = collect_all('developer_disk_image')

# pmd_pytcp is the userspace TCP/IP stack behind the iOS 17+ WiFi tunnel
# (pymobiledevice3 remote/userspace_tunnel.py). The modules it needs today are
# found by static analysis, but its sysctl registry resolves modules through
# sys.modules at runtime; collecting the package keeps a future release that
# loads handlers by name from breaking only the frozen build.
pytcp_datas, pytcp_binaries, pytcp_hidden = collect_all('pmd_pytcp')

# The personalized DDI mount imports pyimg4, which imports apple_compress, and
# both call importlib.metadata.version() on themselves at import time.
# PyInstaller bundles their code but not their .dist-info, so in the frozen
# build that lookup raised PackageNotFoundError and the whole
# mobile_image_mounter import (and with it every iOS 17+ DDI mount) failed.
pyimg4_datas, pyimg4_binaries, pyimg4_hidden = collect_all('pyimg4')
compress_datas, compress_binaries, compress_hidden = collect_all('apple_compress')
dist_metadata = [*copy_metadata('pyimg4'), *copy_metadata('apple_compress')]

# uvicorn/fastapi also need their sub-modules collected
uvicorn_hidden = collect_submodules('uvicorn')
fastapi_hidden = collect_submodules('fastapi')

hidden = [
    *pmd_hiddenimports,
    *pytun_hidden,
    *ddi_hidden,
    *pytcp_hidden,
    *pyimg4_hidden,
    *compress_hidden,
    *uvicorn_hidden,
    *fastapi_hidden,
    'uvicorn.logging',
    'uvicorn.loops',
    'uvicorn.loops.auto',
    'uvicorn.protocols',
    'uvicorn.protocols.http',
    'uvicorn.protocols.http.auto',
    'uvicorn.protocols.websockets',
    'uvicorn.protocols.websockets.auto',
    'uvicorn.lifespan',
    'uvicorn.lifespan.on',
    'websockets',
    'websockets.legacy',
    'websockets.legacy.client',
    'websockets.legacy.server',
    'gpxpy',
    'httpx',
    'multipart',
]

a = Analysis(
    ['main.py'],
    pathex=['.'],
    binaries=[*pmd_binaries, *pytun_binaries, *pytcp_binaries, *ddi_binaries,
              *pyimg4_binaries, *compress_binaries],
    datas=[*pmd_datas, *pytun_datas, *pytcp_datas, *ddi_datas,
           *pyimg4_datas, *compress_datas, *dist_metadata],
    hiddenimports=hidden,
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
    name='gpscontroller-backend',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,   # keep console for logs; change to False for prod if desired
    disable_windowed_traceback=False,
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
    name='gpscontroller-backend',
)
