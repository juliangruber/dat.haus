
# https://dat.haus/

  [Dat](http://dat-data.com/) + Http + Unix.

  The composable HTTP API to the [dat](http://dat-data.com/) network!

## Roadmap

- [x] `curl https://dat.haus/ARCHIVE/FILE > file.txt`
- [ ] `curl https://dat.haus/ARCHIVE.tar > file.tar.gz`
- [x] `curl https://dat.haus/ARCHIVE > info.txt`
- [ ] `cat file | curl -XPOST https://dat.haus/`
- [ ] `tar -cz - . | curl -XPOST https://dat.haus/`
- [ ] `curl -XHEAD https://dat.haus/ARCHIVE/FILE > stat.txt`
- [ ] `curl -XHEAD https://dat.haus/ARCHIVE > stat-and-list.txt`

