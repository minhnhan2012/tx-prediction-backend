# 🎲 TX Prediction Monitor + Predictor Tool v2.0

Advanced Backend cho dự đoán Tài/Xỉu với Betting Assistant (Node.js)

## ✨ Tính Năng Chính

- ✅ Poll API dự đoán từ: `https://aims-discussions-nottingham-milton.trycloudflare.com/api/txmd5`
- ✅ Poll API kết quả từ: `https://wtxmd52.tele68.com/v1/txmd5/sessions`
- ✅ Đối soát phiên và đánh dấu WIN/LOSS tự động
- ✅ 13+ thuật toán dự đoán + Ensemble voting theo trọng số
- 🔧 Hội tụ tự động: hệ thống tự hiệu chỉnh độ tin cậy (calibration) dựa trên lịch sử để khớp tỉ lệ đúng thực tế
- ✅ Gợi ý đặt cược thông minh (có/không, tài/xỉu, % vốn, số tiền cụ thể)
- ✅ Giao diện realtime tại `/tool`
- ✅ Thống kê chi tiết (tỷ lệ thắng, streak, pattern)
- ✅ API RESTful cho tích hợp bot/app
- ✅ Compression middleware (tăng tốc 40%)
- ✅ Logging & Debug tools

## 🚀 Quickstart (Dành cho Windows)

### Cách 1: Chạy file .bat (Dễ nhất)

1. Mở `tx-prediction-backend` folder
2. Double-click file `start.bat`
3. Chờ cài đặt xong
4. Mở trình duyệt: http://localhost:3000/tool

### Cách 2: PowerShell Launcher (Chuyên nghiệp)

```powershell
# Mở PowerShell tại thư mục tx-prediction-backend
# Lần đầu: cài đặt & chạy
.\launcher.ps1 setup
.\launcher.ps1 start

# Lần sau: chạy bình thường
.\launcher.ps1 start
```

### Cách 3: Manual (Chi tiết)

```powershell
# 1. Mở PowerShell/CMD
# 2. Đi tới thư mục
cd "D:\Users\Asus\Downloads\tool\tx-prediction-backend"

# 3. Cài đặt dependencies (lần đầu)
npm install

# 4. Copy file cấu hình
copy .env.example .env

# 5. Chạy tool
npm run start
# Hoặc dev mode (auto-reload):
npm run dev
```

## 🌐 Truy Cập Web UI

```
URL: http://localhost:3000/tool
Port: 3000 (có thể thay đổi trong .env)
```

### 📱 Truy Cập Từ Thiết Bị Khác

Để cho điện thoại, máy tính khác truy cập API:

1. **Cấu hình server**:
   ```env
   HOST=0.0.0.0
   PORT=3000
   ```

2. **Tìm IP của máy**:
   ```powershell
   ipconfig
   ```
   Tìm địa chỉ IPv4 (ví dụ: `192.168.1.100`).

3. **Mở firewall** (Windows):
   ```powershell
   netsh advfirewall firewall add rule name="TX Prediction API" dir=in action=allow protocol=TCP localport=3000
   ```

4. **Truy cập từ thiết bị khác**:
   - Thay `localhost` bằng IP: `http://192.168.1.100:3000/tool`
   - API: `http://192.168.1.100:3000/api/summary`

⚠️ **Lưu ý**: Chỉ dùng trong mạng nội bộ (LAN). Để truy cập từ internet, cần cấu hình router/port forwarding (không khuyến nghị cho production).

## ⚙️ Cấu Hình (.env)

Các tham số quan trọng trong file `.env`:

```env
PORT=3000                              # Cổng server
BETTING_UNIT=1000                      # Đơn vị cược (VND)
PREDICTION_POLL_MS=1500                # Kiểm tra dự đoán (ms)
REQUEST_TIMEOUT_MS=6000                # Timeout API (ms)
BET_ADVICE_MIN_CONFIDENCE=57           # Min confidence để gợi ý
BET_ADVICE_MAX_BANKROLL_PERCENT=8      # Max cược % vốn
LOG_REQUESTS=false                     # Bật log chi tiết
```

👉 **Xem chi tiết**: [GUIDE.md](GUIDE.md)

## 📊 API Response Format

Các endpoint hữu ích:

- `/api/predictor/current` – dữ liệu dự đoán hiện tại (đã có trước)
- `/api/summary` – thông tin phiên + kết quả & dự đoán nhanh
- `/api/analytics/predictions` – **tổng số dự đoán, số đúng, tỉ lệ, và thống kê theo khoảng confidence**


**GET** `/api/predictor/current?bankroll=1000000`

```json
{
  "phien": "6721538",
  "phien_tiep_theo": "6721539",
  "ket_qua": "Tai",
  "xuc_xac": [3, 4, 2],
  "tong": 9,
  "confidence": 72.5,
  "goi_y_dat_cuoc": {
    "nen_dat": true,
    "cua_goi_y": "Tai",
    "muc_do_tin_hieu": "VUA",
    "ti_le_von_goi_y_percent": 4.8,
    "so_tien_goi_y": 48000,
    "ly_do": "Ensemble prediction with high confidence"
  },
  "du_doan_cuoi_cung": {
    "ket_qua": "Tai",
    "confidence_percent": 72.5,
    "phuong_phap": "ENSEMBLE_WEIGHTED_VOTE"
  }
}
```

## 🧠 Thuật Toán Dự Đoán

13 mô hình được sử dụng:

1. **Reference API** - Lấy từ external API
2. **Markov Models** (1-2 order) - Chuỗi Markov
3. **Streak Reversion** - Đảo ngược streak
4. **Money Pressure** - Áp lực tiền
5. **Point Trend** - Xu hướng điểm
6. **Frequency Balance** - Cân bằng tần suất
7. **Short Momentum** - Momentum ngắn hạn
8. **EWMA Trend** - Exponential moving average
9. **Cycle Detector** - Phát hiện chu kỳ
10. **Regime N-gram** - N-gram pattern learning
11. **Cau Pattern** - Khớp mẫu từ file cau-patterns.txt
12. **Mistake Feedback** - Học từ lỗi gần đây
13. **Ensemble** - Tổng hợp có trọng số theo hiệu suất

**Kết quả cuối cùng** = Weighted vote từ tất cả mô hình

## 📡 API Endpoints

| Method | Endpoint | Mô tả |
|--------|----------|-------|
| GET | `/tool` | Web UI |
| GET | `/health` | Kiểm tra server |
| GET | `/api/current-session` | Phiên hiện tại |
| GET | `/api/predictor/current` | Dự đoán với bankroll |
| GET | `/api/history` | Lịch sử phiên |
| GET | `/api/stats/summary` | Thống kê tóm tắt |
| GET | `/api/alerts` | Cảnh báo |
| GET | `/api/dashboard` | Dashboard data |
| GET | `/api/stream` | SSE (realtime events) |
| POST | `/api/sync` | Cập nhật dữ liệu |

## 🔧 Troubleshooting

### Node.js không tìm thấy
```powershell
# Cài đặt từ: https://nodejs.org/
# Khởi động lại PowerShell
node --version  # Kiểm tra
```

### Port 3000 đang dùng
```powershell
# Đổi PORT trong .env
PORT=3001

# Hoặc dừng process Node.js
Get-Process node | Stop-Process
```

### API không trả dữ liệu
```powershell
# Tăng timeout trong .env
REQUEST_TIMEOUT_MS=10000

# Kiểm tra kết nối mạng
ping google.com
```

Xem chi tiết: [GUIDE.md - Troubleshooting](GUIDE.md#-troubleshooting)

## 📈 Phiên Bản

- **v2.0.0** ⭐ (Hiện tại)
  - Compression middleware
  - Enhanced logging
  - Performance optimizations
  - Better error handling

## ⚠️ Lưu Ý Quan Trọng

- ❗ **Dự đoán chỉ là mô hình thống kê/heuristic** - không đảm bảo kết quả
- ❗ **Gợi ý đặt cược không phải cam kết lợi nhuận** - chỉ là hướng dẫn quản lý rủi ro
- ❗ **Luôn quản lý vốn một cách cẩn thận** - không nên cược quá lớn
- ✅ **Theo dõi hiệu suất** - kiểm tra tỷ lệ thắng thực tế
- ✅ **Cập nhật API** - nếu API endpoint thay đổi, cập nhật trong `.env`

## 📝 Liên Hệ & Support

Nếu gặp vấn đề:
1. Kiểm tra [GUIDE.md](GUIDE.md)
2. Kiểm tra logs (bật `LOG_REQUESTS=true` trong .env)
3. Kiểm tra kết nối mạng
4. Restart server: Ctrl+C rồi `npm run start`

---

**Status**: ✅ Production Ready  
**Last Updated**: 2025-03-11  
**License**: MIT



