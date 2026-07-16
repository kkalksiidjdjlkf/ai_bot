import * as fs from 'fs';
import * as path from 'path';

// Общий bookings.json — корневая папка data/
const BOOKING_FILE = path.join(__dirname, '..', '..', '..', 'data', 'bookings.json');

export class BookingStore {
    private bookings: any[] = [];
    private lock = false;

    constructor() {
        this.load();
    }

    private load() {
        if (fs.existsSync(BOOKING_FILE)) {
            try {
                const data = fs.readFileSync(BOOKING_FILE, 'utf-8');
                const parsed = JSON.parse(data);
                this.bookings = Array.isArray(parsed) ? parsed : [];
            } catch {
                this.bookings = [];
            }
        } else {
            this.bookings = [];
        }
    }

    private save() {
        if (this.lock) return;
        this.lock = true;
        try {
            // Ensure directory exists
            fs.mkdirSync(path.dirname(BOOKING_FILE), { recursive: true });
            // Atomic write: write to temp then rename
            const tmpFile = BOOKING_FILE + '.tmp';
            fs.writeFileSync(tmpFile, JSON.stringify(this.bookings, null, 2), 'utf-8');
            fs.renameSync(tmpFile, BOOKING_FILE);
        } finally {
            this.lock = false;
        }
    }

    add(patientName: string, serviceName: string, date: string, time: string, phone: string, age?: number, doctor?: string): string | null {
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

    checkConflict(date: string, time: string): boolean {
        return this.bookings.some(b => b.date === date && b.time === time && b.status === 'confirmed');
    }

    clear(): void {
        this.bookings = [];
        this.save();
    }

    getAll(): any[] {
        return [...this.bookings];
    }
}