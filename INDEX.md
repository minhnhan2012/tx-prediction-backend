╔════════════════════════════════════════════════════════════════════════════════╗
║                                                                                ║
║           📚 TX PREDICTOR TOOL v2.0 - FILE INDEX & DOCUMENTATION               ║
║                                                                                ║
╚════════════════════════════════════════════════════════════════════════════════╝


🚀 START HERE - BẮT ĐẦU TỪ ĐÂY
═══════════════════════════════════════════════════════════════════════════════════

  1️⃣ HOW_TO_RUN.txt ⭐⭐⭐ (ĐỌC NGAY)
     → 1 trang, 5 phút
     → Cách chạy tool trong 4 bước
     → Troubleshooting nhanh
  
  2️⃣ start.bat (CHẠY NGAY)
     → Double-click để chạy tool
     → Windows batch script
     → Tự động cài npm packages
  
  3️⃣ QUICKSTART.txt (5-10 phút)
     → Hướng dẫn nhanh chi tiết
     → 3 cách chạy tool
     → Cấu hình cơ bản


📖 DOCUMENTATION - TÀI LIỆU
═══════════════════════════════════════════════════════════════════════════════════

  README.md ⭐⭐ (TOÀN CẢNH)
  └─ Giới thiệu chung về tool
  └─ Tính năng chính
  └─ Quickstart (3 cách)
  └─ API endpoints
  └─ 13 thuật toán dự đoán
  └─ Cấu hình
  └─ Troubleshooting


  GUIDE.md ⭐⭐ (CHI TIẾT - 350+ DÒNG)
  └─ 1. Yêu cầu hệ thống
  └─ 2. Cài đặt (3 cách)
  └─ 3. Cấu hình .env
  └─ 4. Chạy tool (Production & Dev)
  └─ 5. Sử dụng (Chức năng & API)
  └─ 6. Troubleshooting (7+ vấn đề)
  └─ 7. Tips & Tricks
  └─ 8. Tính năng v2.0


  QUICKSTART.txt ⭐⭐ (5 PHÚT)
  └─ Cách 1: Run .bat file (dễ nhất)
  └─ Cách 2: PowerShell launcher
  └─ Cách 3: Manual via command line
  └─ Cấu hình cơ bản
  └─ Troubleshooting
  └─ Tips & Tricks


  CHANGELOG.md (THAY ĐỔI)
  └─ Tất cả tính năng mới v2.0
  └─ So sánh v1.0 vs v2.0
  └─ Roadmap v2.1+
  └─ Known issues


  UPGRADE_SUMMARY.txt (TÓM TẮT)
  └─ Danh sách files nâng cấp
  └─ Tính năng v2.0
  └─ Checklist
  └─ Troubleshooting


🔧 SCRIPTS - TỰ ĐỘNG CHẠY
═══════════════════════════════════════════════════════════════════════════════════

  start.bat (WINDOWS BATCH)
  ├─ Double-click để chạy
  ├─ Tự động cài npm packages
  ├─ Tự động copy .env.example → .env
  └─ Chạy: npm run start
  
  
  launcher.ps1 (POWERSHELL - CHUYÊN NGHIỆP)
  ├─ .\launcher.ps1 start   → Chạy production mode
  ├─ .\launcher.ps1 dev     → Chạy dev mode (auto-reload)
  ├─ .\launcher.ps1 setup   → Cài đặt dependencies
  ├─ .\launcher.ps1 clean   → Xoá database
  ├─ .\launcher.ps1 stats   → Export thống kê
  └─ .\launcher.ps1 help    → Xem trợ giúp


⚙️ CONFIGURATION - CẤU HÌNH
═══════════════════════════════════════════════════════════════════════════════════

  .env (PRODUCTION SETTINGS)
  └─ Copy từ .env.example
  └─ Sửa theo nhu cầu:
     • PORT = cổng server
     • BETTING_UNIT = đơn vị cược
     • PREDICTION_POLL_MS = kiểm tra dự đoán
     • BET_ADVICE_MIN_CONFIDENCE = độ tin cậy
     • LOG_REQUESTS = bật log chi tiết
  

  .env.example (TEMPLATE)
  └─ Tất cả cấu hình mặc định
  └─ Đọc để hiểu các tham số


📦 PROJECT FILES - TỆP DỰ ÁN
═══════════════════════════════════════════════════════════════════════════════════

  package.json
  └─ Phiên bản: 2.0.0
  └─ Dependencies: express, cors, compression, dotenv
  └─ Scripts: start, dev, check, clear-db, export-stats


  src/ (SOURCE CODE)
  ├─ server.js        → Main server file (nâng cấp v2.0)
  ├─ analytics.js     → Thống kê
  ├─ cauPattern.js    → Pattern matching
  ├─ config.js        → Configuration loader
  ├─ database.js      → Database management
  ├─ monitorService.js → Monitoring
  ├─ normalizers.js   → Data normalization
  └─ predictorEngine.js → Prediction algorithms
  

  public/ (WEB UI)
  ├─ tool.html        → Giao diện web
  ├─ tool.css         → Styling
  ├─ tool.js          → Frontend logic
  └─ tool.svg         → Icons/graphics
  

  data/ (DATABASE & CACHE)
  ├─ tx-monitor.sqlite → SQLite database
  └─ cau-patterns.txt → Pattern data


  node_modules/ (DEPENDENCIES)
  └─ npm packages đã cài
  └─ Tự động tạo khi: npm install


🌐 WEB INTERFACE - GIAO DIỆN WEB
═══════════════════════════════════════════════════════════════════════════════════

  Khi chạy tool, mở trình duyệt:
  
  URL: http://localhost:3000/tool
  
  Tính năng:
  ✓ Dự đoán Tài/Xỉu phiên tiếp theo
  ✓ Gợi ý đặt cược (có/không, số tiền)
  ✓ Thống kê realtime (win rate, streak)
  ✓ Lịch sử phiên (100+ phiên)
  ✓ Xúc xắc & tổng điểm
  ✓ Confidence score


📡 API ENDPOINTS - CÁC API
═══════════════════════════════════════════════════════════════════════════════════

  GET /tool
  └─ Web UI
  
  
  GET /health
  └─ Kiểm tra server
  
  
  GET /api/predictor/current?bankroll=1000000
  └─ Dự đoán hiện tại
  └─ Với số dư (bankroll)
  
  
  GET /api/current-session
  └─ Phiên hiện tại
  
  
  GET /api/history?limit=100
  └─ Lịch sử phiên
  
  
  GET /api/stats/summary
  └─ Thống kê tóm tắt
  
  
  GET /api/alerts
  └─ Cảnh báo
  
  
  GET /api/dashboard
  └─ Dashboard data


🔍 FILE GUIDE - HƯỚNG DẪN ĐỌC FILE
═══════════════════════════════════════════════════════════════════════════════════

  TÌNH HỬ               FILE ĐỊP ĐỌC              THỜI GIAN
  ──────────────────────────────────────────────────────────
  Mới bắt đầu        → HOW_TO_RUN.txt            5 phút
                     → start.bat (chạy)
  
  Muốn hiểu tool     → QUICKSTART.txt             10 phút
                     → README.md                  15 phút
  
  Cần chi tiết       → GUIDE.md                   30 phút
  (troubleshooting)
  
  Muốn biết thay đổi → CHANGELOG.md               10 phút
  
  Muốn tổng quan     → UPGRADE_SUMMARY.txt        10 phút


✅ CHECKLIST - BƯỚC KHỞI ĐỘNG
═══════════════════════════════════════════════════════════════════════════════════

  [ ] 1. Cài Node.js >= 18.0.0 từ https://nodejs.org/
  
  [ ] 2. Mở thư mục: D:\Users\Asus\Downloads\tool\tx-prediction-backend
  
  [ ] 3. Double-click: start.bat
  
  [ ] 4. Chờ cài đặt hoàn tất (2-5 phút lần đầu)
  
  [ ] 5. Kiểm tra PowerShell không báo lỗi
  
  [ ] 6. Mở trình duyệt: http://localhost:3000/tool
  
  [ ] 7. Dùng tool và xem dự đoán Tài/Xỉu!


🚀 LỆNH NHANH - QUICK COMMANDS
═══════════════════════════════════════════════════════════════════════════════════

  # Chạy production mode
  npm run start
  
  # Chạy dev mode (auto-reload)
  npm run dev
  
  # Cài dependencies
  npm install
  
  # Kiểm tra syntax
  npm run check
  
  # PowerShell launcher (lần đầu)
  .\launcher.ps1 setup
  
  # PowerShell launcher (chạy)
  .\launcher.ps1 start
  
  # PowerShell launcher (dev mode)
  .\launcher.ps1 dev
  
  # Dừng server
  Ctrl + C


⚠️ CẦN LƯU Ý
═══════════════════════════════════════════════════════════════════════════════════

  ⚠️  Dự đoán chỉ là mô hình thống kê - không đảm bảo kết quả
  ⚠️  Gợi ý cược không phải cam kết lợi nhuận
  ⚠️  Luôn quản lý vốn cẩn thận
  ⚠️  Không nên cược quá 10% số dư
  
  ✅ Theo dõi hiệu suất thực tế
  ✅ Cập nhật API nếu endpoint thay đổi
  ✅ Backup database thường xuyên


📞 SUPPORT
═══════════════════════════════════════════════════════════════════════════════════

  Gặp vấn đề? Làm theo thứ tự này:
  
  1. Đọc: HOW_TO_RUN.txt → QUICKSTART.txt
  2. Kiểm tra: Node.js version (node --version)
  3. Xoá: node_modules + package-lock.json
  4. Cài lại: npm install
  5. Xem logs: set LOG_REQUESTS=true trong .env
  6. Đọc chi tiết: GUIDE.md - Phần Troubleshooting


═══════════════════════════════════════════════════════════════════════════════════

  Version: 2.0.0
  Status: ✅ Production Ready
  Last Updated: 2025-03-11
  
  🎉 Chúc bạn sử dụng tool thành công!

═══════════════════════════════════════════════════════════════════════════════════
