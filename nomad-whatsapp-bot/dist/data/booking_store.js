"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.BookingStore = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const BOOKING_FILE = path.join(__dirname, 'bookings.json');
class BookingStore {
    constructor() {
        this.bookings = [];
        this.load();
    }
    load() {
        if (fs.existsSync(BOOKING_FILE)) {
            const data = fs.readFileSync(BOOKING_FILE, 'utf-8');
            this.bookings = JSON.parse(data);
        }
        else {
            this.bookings = [];
        }
    }
    save() {
        fs.writeFileSync(BOOKING_FILE, JSON.stringify(this.bookings, null, 2));
    }
    add(patientName, serviceName, date, time, phone, age, doctor) {
        if (this.checkConflict(date, time)) {
            return null;
        }
        const id = Math.random().toString(36).substr(2, 8);
        const booking = {
            id,
            patientName,
            serviceName,
            date,
            time,
            phone,
            age,
            doctor,
            status: 'confirmed',
            createdAt: new Date().toISOString()
        };
        this.bookings.push(booking);
        this.save();
        return id;
    }
    checkConflict(date, time) {
        return this.bookings.some(b => b.date === date && b.time === time && b.status === 'confirmed');
    }
}
exports.BookingStore = BookingStore;
