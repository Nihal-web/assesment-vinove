# Distributed Order Processing System

This project is a robust, microservices-based Order Processing System that implements the **Saga Pattern** for distributed transactions. It ensures high concurrency, absolute idempotency, and seamless crash recovery.

## Architecture
- **Coordinator Service**: The saga orchestrator ("the brain") that processes orders in parallel batches (Port 3000).
- **Order Service**: Creates or cancels orders (Port 3001).
- **Inventory Service**: Manages and seeds stock from CSV (Port 3002).
- **Payment Service**: Processes charges and refunds (Port 3003).
- **Shipping Service**: Arranges or cancels shipments (Port 3004).
- **Notification Service**: Independent cron job that notifies "Shipped" orders (Port 3005).
- **Frontend**: Angular 17 Dashboard with real-time status and saga tracking (Port 4200).

## How to Run

### 1. Database Setup (MySQL)
1. Ensure your local MySQL server (or XAMPP) is running.
2. Execute the provided SQL script located at `mysql-init/01-init.sql` in your MySQL client (e.g. phpMyAdmin, MySQL Workbench). This single script will automatically create all 6 databases and their respective tables.
3. *Note: By default, the services connect to localhost with the user `root` and an empty password (perfect for XAMPP). If your DB has a password, update it in the connection pools.*

### 2. Install Dependencies
Open a terminal in the root folder and run:
```bash
npm run install:all
```
*(This script will automatically navigate into all backend folders and the frontend folder to install packages).*

### 3. Start the System
Once installation is complete, run:
```bash
npm run start:all
```
*(This will concurrently start all 6 Node.js services and the Angular frontend).*

### 4. Access the UI
Open your browser and navigate to **http://localhost:4200**.
Click on **"Process Bulk CSV"** to start the coordinator stream processing.

## Automated Testing
The system includes automated tests to verify the core requirements (Success flow, Rollback/Undo flow, and Idempotency). 
To run the tests, ensure the backend services are running, then execute:
```bash
cd backend/coordinator
node test.js
```
