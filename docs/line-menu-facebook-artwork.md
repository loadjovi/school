# Facebook 選單圖片

使用內建影像工具，依使用者提供的家長四格圖生成同風格新版。原始 PNG 保留於生成結果；LINE 用的 JPEG 僅做格式編碼，維持 1536 × 1024 尺寸與內容，兩張皆小於 1 MB。

| 圖片 | 程式內檔案 | 公開預覽 |
|---|---|---|
| 家長五格 | `api/src/assets/line-parent-facebook.jpg` | `/line-menu-parent-facebook.jpg` |
| 幹部六格 | `api/src/assets/line-staff-facebook.jpg` | `/line-menu-staff-facebook.jpg` |

## 家長圖提示

```text
Use case: precise-object-edit. Asset type: production LINE rich menu bitmap, landscape exactly 1536x1024 pixels, opaque white background. Input image 1 is the edit target. Update this parent menu by preserving its pastel colors, navy Traditional Chinese typography, circular white line icons, rounded card styling and the four existing functions, and ADD a fifth Facebook function. Reflow into exactly FIVE large cards: top row three equal-width cards, bottom row two equal-width cards; horizontal divider precisely at 50% height, top vertical dividers precisely at one-third and two-thirds width, bottom vertical divider precisely at half width. Small equal white gutters, cards inset uniformly, no header/footer. Each card has an icon centered above a large bold Traditional Chinese title and small English subtitle below. Top left light blue calendar-clock icon title "今日課程" subtitle "TODAY"; top middle pale amber megaphone title "最新公告" subtitle "LATEST NEWS"; top right pale mint calendar-check title "活動行事曆" subtitle "EVENT CALENDAR". Bottom left pale lavender house title "開啟家長平台" subtitle "PARENT PORTAL"; bottom right pale Facebook-blue card with recognizable white lowercase f inside a blue circle title "活動影音" subtitle "FACEBOOK". Keep the EXACT requested five functions, no duplicates, no extra sixth card, no URLs or school-specific names, no mockup frame, no watermark. Refined consistent flat vector-like icons, crisp accurate Chinese text, high contrast at phone size. Use simple smooth pastel fills to keep PNG file lightweight.
```

## 幹部圖提示

```text
Use case: ui-mockup. Asset type: NEW production LINE staff rich menu bitmap, landscape exactly1536x1024 pixels, opaque white background. Input image1 is a STYLE REFERENCE only, not the target. Create an exactly SIX-card menu matching its sophisticated soft pastel rounded panels, fine colored outlines, navy bold Traditional Chinese labels, small muted English subtitles, large colored circular icon with white line symbol. Exactly three equal columns by two equal rows. Dividers precisely one-third and two-thirds canvas width, and half canvas height, equal tiny white gutters. No heading, footer or external frame. Six cards in row-major order: 1 lightblue calendar-clock symbol, title "今日課程", subtitle "TODAY"; 2 lightmint calendar-check symbol, title "活動行事曆", subtitle "CALENDAR"; 3 paleamber megaphone symbol title "最新公告", subtitle "NEWS"; 4 mint/teal clipboard-check symbol title "點名管理", subtitle "ATTENDANCE"; 5 warmcream document-check symbol title "待辦事項", subtitle "TO-DO"; 6 softFacebookblue card with recognizable white lowercase f in blue circle, title "活動影音", subtitle "FACEBOOK". The last cell replaces the old staff portal concept: DO NOT include "開啟幹部平台", "STAFF PORTAL" or any person-plus icon. No URL, school name or watermark. Accurate crisp Traditional Chinese text and a coordinated flat vector-like style matching the reference, suitable at mobile size, no three-dimensional button bevels. Simple fills, lightweight PNG.
```
