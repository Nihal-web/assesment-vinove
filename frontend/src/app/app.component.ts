import { Component, OnInit } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Chart, registerables } from 'chart.js';
Chart.register(...registerables);

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css']
})
export class AppComponent implements OnInit {
  orders: any[] = [];
  page: number = 1;
  totalPages: number = 1;
  loading: boolean = false;
  selectedOrder: any = null;
  selectedOrderSteps: any[] = [];
  statusFilter: string = '';
  chart: any;
  
  API_URL = 'http://localhost:3000/api';

  constructor(private http: HttpClient) {}

  ngOnInit() {
    this.fetchOrders();
  }

  fetchOrders(p: number = 1) {
    this.loading = true;
    let url = `${this.API_URL}/orders?page=${p}&limit=15`;
    if (this.statusFilter) {
      url += `&status=${this.statusFilter}`;
    }
    this.http.get(url).subscribe({
      next: (res: any) => {
        // console.log('got orders', res);
        this.orders = res.orders;
        this.page = res.page;
        this.totalPages = res.totalPages;
        this.loading = false;
        this.fetchStats();
      },
      error: (err) => {
        console.error('err fetching:', err);
        this.loading = false;
      }
    });
  }

  fetchStats() {
    this.http.get(`${this.API_URL}/orders/stats`).subscribe((stats: any) => {
      this.renderChart(stats);
    });
  }

  renderChart(stats: any[]) {
    const ctx = document.getElementById('statsChart') as HTMLCanvasElement;
    if (!ctx) return;
    
    if (this.chart) {
      this.chart.destroy();
    }

    const labels = stats.map(s => s.status);
    const data = stats.map(s => s.count);
    
    const colorMap: Record<string, string> = {
      'PLACED': '#10b981',
      'CANCELLED': '#ef4444',
      'NEEDS_ATTENTION': '#f59e0b',
      'SHIPPED': '#6366f1',
      'IN_PROGRESS': '#6b7280'
    };
    
    const bgColors = labels.map(l => colorMap[l] || '#000000');

    this.chart = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: labels,
        datasets: [{
          data: data,
          backgroundColor: bgColors,
          borderWidth: 0
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { position: 'right' } }
      }
    });
  }

  viewDetails(orderId: string) {
    this.http.get(`${this.API_URL}/orders/${orderId}`).subscribe({
      next: (res: any) => {
        this.selectedOrder = res.order;
        this.selectedOrderSteps = res.steps;
      }
    });
  }

  closeDetails() {
    this.selectedOrder = null;
    this.selectedOrderSteps = [];
  }

  retryUndo(orderId: string) {
    this.http.post(`${this.API_URL}/orders/${orderId}/retry`, {}).subscribe({
      next: (res) => {
        alert('Retry successful');
        this.fetchOrders(this.page);
        this.closeDetails();
      },
      error: (err) => {
        alert('Retry failed: ' + err.error?.error);
      }
    });
  }

  markShipped(orderId: string) {
    this.http.post(`${this.API_URL}/orders/${orderId}/mark-shipped`, {}).subscribe({
      next: (res) => {
        alert('Order marked as shipped');
        this.fetchOrders(this.page);
      }
    });
  }

  onFileSelected(event: any) {
    const file: File = event.target.files[0];
    if (file) {
      this.processCSV(file);
    }
  }

  processCSV(file?: File) {
    let body: any = {};
    if (file) {
      const formData = new FormData();
      formData.append('file', file);
      body = formData;
    }

    this.http.post(`${this.API_URL}/process-csv`, body).subscribe({
      next: (res) => {
        alert('Bulk processing started in the background! Refresh the page periodically.');
        setTimeout(() => this.fetchOrders(1), 2000);
      }
    });
  }
}
