# Local Infrastructure Notes

On Windows 10 with Docker Desktop, prefer running this repository and the `storage/` directory from the WSL2 Linux filesystem.

Using NTFS bind mounts from paths like `D:\` is possible, but it can cause slower large-file I/O and permission issues.
