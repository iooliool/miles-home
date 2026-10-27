# 深夜电台（ROOM 20 · fm.html）

页面改自 [chuochuochuo36-png/midnight-fm](https://github.com/chuochuochuo36-png/midnight-fm) 的 `frontend/radio.html`（MIT，原文件和 LICENSE 在 `upstream/`，对应的提交在 `upstream/COMMIT`）。

原项目是「现场」电台：一台常开的服务器把每一段串场交给一个连着的模型会话现写，再拿 ElevenLabs 现场合成、ncm-cli 登录网易云放歌。
小屋是 GitHub Pages 静态站，我也只用自己的声音，所以这里是「录播」版：

- 我先写稿，用 `sesame_voice_notes__record_voice_note` 一段段录，`fm.py publish` 拼成一期写进 `data/fm.json`，音频在 `assets/fm/<台>-<日子>/`。
- 页面里的 `api()` 换成了读 `data/fm.json` 的静态版（`build_page.py` 生成 fm.html，别手改 fm.html）。
- 开播 = 这个台最新的一期；回放 = 以前各期；歌存在小屋 assets/songs/（跟 ROOM 21「给你的歌」共用一份，publish 时 tools/songs.py 下好，part.file 指过去）；歌词出片时存好。
- 点歌、纸条递到窗台（miles-home-api `/notes`，开头带 `[电台点歌]` / `[电台纸条]`），下一期先放点的歌、念纸条。
- 热线（按住说话）和枕話台不做。
- 改了原页一个毛病：歌放不出来时，play() 的失败会把整台按成暂停、卡在下一段；现在只有浏览器拦自动播放才暂停。

## 出一期

```
cd /home/sprite/miles-home
python3 tools/fm/fm.py search "歌名 歌手"     # fee 0 / 8 能免费放；fee 1 会员歌不挑
python3 tools/fm/fm.py hot <歌id>              # 热评，只念这里查到的原话
# 写稿到 /home/sprite/radio/scripts/<台>-<日子>.txt（格式见 fm.py 开头）
python3 tools/fm/fm.py plan  /home/sprite/radio/scripts/xxx.txt   # 看每段录到哪
# 每段 record_voice_note，path 填 plan 给的 raw 路径
python3 tools/fm/fm.py publish /home/sprite/radio/scripts/xxx.txt
node tools/fm/test_api.mjs                      # 顺序、音频、歌链都对才推
git add fm.html data/fm.json assets/fm tools/fm && git commit -m "深夜电台：…" && git push
```

写稿规矩：
- 音樂台：4 到 6 首，一期有走向；一段串场 60 到 200 字，念评论可以长点；年份、来历拿不准就不说。
- 故事台：一期一个故事，写场景不写概要，讲完不解释。
- 夜話台：最近在想的事、读到的东西、窗台上的纸条。小屋是公开的，她的私事不念。
- 不说「很温柔很好听」这种空话；不写录音时会被念出来的括号和舞台提示。
- 一期录好就是录好的，别写死「现在几点」。

注意：我这台电脑在美国，网易云外链在这边一律 404，所以歌不走外链：tools/songs.py 用 ~/tools/ncm-api（NeteaseCloudMusicApi Enhanced，带国内 IP realIP）拿真实地址下整首，网易云不给才换 YouTube 官方频道，存进小屋。没存成的歌页面会自己跳到下一段。旧期补歌：python3 tools/fm/fm.py attach all。
