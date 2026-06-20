import * as fs from 'fs';
import * as path from 'path';

const BOOKING_FILE = path.join(__dirname, 'bookings.json');

export class BookingStore {
    private bookings: any[] = [];

    constructor() {
        this.load();
    }

    private load() {
        if (fs.existsSync(BOOKING_FILE)) {
            const data = fs.readFileSync(BOOKING_FILE, 'utf-8');
            this.bookings = JSON.parse(data);
        } else {
            this.bookings = [];
        }
    }

    private save() {
        fs.writeFileSync(BOOKING_FILE, JSON.stringify(this.bookings, null, 2));
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
}