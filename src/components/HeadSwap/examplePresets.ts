/**
 * 內建示範人像與目標身型範本（100% 免版稅、純前端向量繪製 Data URL，零網路延遲）
 */

export interface PresetItem {
  id: string
  name: string
  thumbDataUrl: string
}

function createSvgDataUrl(svgString: string): string {
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svgString.trim())
}

// 4 款示範頭像
export const HEAD_PRESETS: PresetItem[] = [
  {
    id: 'head-female-blonde',
    name: '典雅微捲金髮',
    thumbDataUrl: createSvgDataUrl(`
      <svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400">
        <defs>
          <linearGradient id="bgA" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#2e243a"/>
            <stop offset="100%" stop-color="#181622"/>
          </linearGradient>
          <linearGradient id="skinA" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stop-color="#fed7aa"/>
            <stop offset="100%" stop-color="#fba872"/>
          </linearGradient>
          <linearGradient id="hairA" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#fde047"/>
            <stop offset="50%" stop-color="#eab308"/>
            <stop offset="100%" stop-color="#ca8a04"/>
          </linearGradient>
        </defs>
        <rect width="400" height="400" fill="url(#bgA)"/>
        <path d="M165 240 L165 310 C165 340 110 370 70 400 L330 400 C290 370 235 340 235 310 L235 240 Z" fill="url(#skinA)"/>
        <path d="M110 180 C90 280 100 370 120 400 L280 400 C300 370 310 280 290 180 Z" fill="url(#hairA)"/>
        <ellipse cx="200" cy="205" rx="68" ry="88" fill="url(#skinA)"/>
        <path d="M120 180 C110 110 140 70 200 70 C260 70 290 110 280 180 C260 140 230 130 200 135 C170 130 140 140 120 180 Z" fill="url(#hairA)"/>
        <ellipse cx="172" cy="195" rx="8" ry="5" fill="#1e1b4b"/>
        <ellipse cx="228" cy="195" rx="8" ry="5" fill="#1e1b4b"/>
        <path d="M160 183 Q172 178 184 183" stroke="#a16207" stroke-width="3" fill="none" stroke-linecap="round"/>
        <path d="M216 183 Q228 178 240 183" stroke="#a16207" stroke-width="3" fill="none" stroke-linecap="round"/>
        <path d="M200 200 L196 220 L204 220" stroke="#ea580c" stroke-width="2" fill="none" stroke-linecap="round" opacity="0.6"/>
        <path d="M186 242 Q200 256 214 242" stroke="#e11d48" stroke-width="3.5" fill="none" stroke-linecap="round"/>
      </svg>
    `),
  },
  {
    id: 'head-male-suit',
    name: '俐落短髮男士',
    thumbDataUrl: createSvgDataUrl(`
      <svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400">
        <defs>
          <linearGradient id="bgB" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#1e293b"/>
            <stop offset="100%" stop-color="#0f172a"/>
          </linearGradient>
          <linearGradient id="skinB" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stop-color="#ffedd5"/>
            <stop offset="100%" stop-color="#fbd38d"/>
          </linearGradient>
        </defs>
        <rect width="400" height="400" fill="url(#bgB)"/>
        <path d="M160 235 L160 300 L240 300 L240 235 Z" fill="url(#skinB)"/>
        <path d="M135 170 C135 130 160 100 200 100 C240 100 265 130 265 170 C265 235 235 270 200 270 C165 270 135 235 135 170 Z" fill="url(#skinB)"/>
        <path d="M130 160 C125 105 155 75 200 75 C245 75 275 105 270 160 C260 120 230 110 200 115 C170 110 140 120 130 160 Z" fill="#1e293b"/>
        <path d="M155 175 Q172 170 188 176" stroke="#0f172a" stroke-width="4" fill="none" stroke-linecap="round"/>
        <path d="M212 176 Q228 170 245 175" stroke="#0f172a" stroke-width="4" fill="none" stroke-linecap="round"/>
        <circle cx="172" cy="187" r="6" fill="#0f172a"/>
        <circle cx="228" cy="187" r="6" fill="#0f172a"/>
        <path d="M185 235 Q200 244 215 235" stroke="#b45309" stroke-width="3" fill="none" stroke-linecap="round"/>
      </svg>
    `),
  },
  {
    id: 'head-female-dark',
    name: '烏黑長髮美女',
    thumbDataUrl: createSvgDataUrl(`
      <svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400">
        <defs>
          <linearGradient id="skinC" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stop-color="#fde68a"/>
            <stop offset="100%" stop-color="#f59e0b"/>
          </linearGradient>
        </defs>
        <rect width="400" height="400" fill="#111827"/>
        <path d="M165 240 L165 310 C165 340 110 370 70 400 L330 400 C290 370 235 340 235 310 L235 240 Z" fill="url(#skinC)"/>
        <path d="M105 180 C85 280 90 380 100 400 L300 400 C310 380 315 280 295 180 Z" fill="#171717"/>
        <ellipse cx="200" cy="205" rx="66" ry="86" fill="#ffedd5"/>
        <path d="M118 180 C110 100 140 68 200 68 C260 68 290 100 282 180 C260 135 230 128 200 130 C170 128 140 135 118 180 Z" fill="#171717"/>
        <circle cx="172" cy="195" r="5.5" fill="#171717"/>
        <circle cx="228" cy="195" r="5.5" fill="#171717"/>
        <path d="M186 242 Q200 254 214 242" stroke="#f43f5e" stroke-width="3" fill="none" stroke-linecap="round"/>
      </svg>
    `),
  },
  {
    id: 'head-curly-hair',
    name: '捲髮陽光型女',
    thumbDataUrl: createSvgDataUrl(`
      <svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400">
        <rect width="400" height="400" fill="#18181b"/>
        <circle cx="200" cy="180" r="115" fill="#451a03"/>
        <circle cx="120" cy="170" r="50" fill="#451a03"/>
        <circle cx="280" cy="170" r="50" fill="#451a03"/>
        <path d="M165 240 L165 310 C165 340 110 370 70 400 L330 400 C290 370 235 340 235 310 L235 240 Z" fill="#d97706"/>
        <ellipse cx="200" cy="205" rx="66" ry="86" fill="#f59e0b"/>
        <path d="M135 160 Q170 130 200 145 Q230 130 265 160 Z" fill="#451a03"/>
        <circle cx="172" cy="195" r="6" fill="#1f2937"/>
        <circle cx="228" cy="195" r="6" fill="#1f2937"/>
        <path d="M184 244 Q200 258 216 244" stroke="#be123c" stroke-width="4" fill="none" stroke-linecap="round"/>
      </svg>
    `),
  },
]

// 4 款示範目標身型底圖
export const TARGET_PRESETS: PresetItem[] = [
  {
    id: 'target-trench-coat',
    name: '時尚風衣外景',
    thumbDataUrl: createSvgDataUrl(`
      <svg xmlns="http://www.w3.org/2000/svg" width="400" height="520" viewBox="0 0 400 520">
        <defs>
          <linearGradient id="cityBg" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stop-color="#0f172a"/>
            <stop offset="50%" stop-color="#334155"/>
            <stop offset="100%" stop-color="#475569"/>
          </linearGradient>
          <linearGradient id="coat" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#d97706"/>
            <stop offset="100%" stop-color="#b45309"/>
          </linearGradient>
        </defs>
        <rect width="400" height="520" fill="url(#cityBg)"/>
        <circle cx="200" cy="125" r="55" fill="#334155" opacity="0.5"/>
        <path d="M155 180 L140 270 L80 520 L320 520 L260 270 L245 180 Z" fill="url(#coat)"/>
        <path d="M170 170 L200 220 L230 170 Z" fill="#09090b"/>
        <path d="M140 200 L200 280 L260 200" stroke="#78350f" stroke-width="6" fill="none"/>
      </svg>
    `),
  },
  {
    id: 'target-navy-suit',
    name: '深藍商務西裝',
    thumbDataUrl: createSvgDataUrl(`
      <svg xmlns="http://www.w3.org/2000/svg" width="400" height="520" viewBox="0 0 400 520">
        <rect width="400" height="520" fill="#090d16"/>
        <circle cx="200" cy="125" r="55" fill="#1e293b" opacity="0.4"/>
        <path d="M165 170 L200 250 L235 170 Z" fill="#ffffff"/>
        <path d="M194 200 L206 200 L210 320 L200 340 L190 320 Z" fill="#dc2626"/>
        <path d="M145 180 L50 360 L40 520 L360 520 L350 360 L255 180 L200 310 Z" fill="#1e3a8a"/>
      </svg>
    `),
  },
  {
    id: 'target-sci-fi-armor',
    name: '科幻機甲戰甲',
    thumbDataUrl: createSvgDataUrl(`
      <svg xmlns="http://www.w3.org/2000/svg" width="400" height="520" viewBox="0 0 400 520">
        <rect width="400" height="520" fill="#050505"/>
        <circle cx="200" cy="125" r="55" fill="#262626" opacity="0.5"/>
        <path d="M150 180 L40 230 L30 520 L370 520 L360 230 L250 180 Z" fill="#991b1b"/>
        <circle cx="200" cy="280" r="32" fill="#38bdf8"/>
        <circle cx="200" cy="280" r="18" fill="#f0f9ff"/>
        <path d="M140 210 L200 240 L260 210 L200 360 Z" stroke="#fbbf24" stroke-width="5" fill="none"/>
      </svg>
    `),
  },
  {
    id: 'target-beach-wear',
    name: '陽光海灘渡假',
    thumbDataUrl: createSvgDataUrl(`
      <svg xmlns="http://www.w3.org/2000/svg" width="400" height="520" viewBox="0 0 400 520">
        <rect width="400" height="300" fill="#0284c7"/>
        <rect y="300" width="400" height="220" fill="#fde047"/>
        <circle cx="200" cy="125" r="55" fill="#0369a1" opacity="0.4"/>
        <path d="M160 170 L70 260 L60 520 L340 520 L330 260 L240 170 Z" fill="#f59e0b"/>
        <path d="M140 220 L70 290 L60 520 L340 520 L330 290 L260 220 Z" fill="#059669"/>
      </svg>
    `),
  },
]
