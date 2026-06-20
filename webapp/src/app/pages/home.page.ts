import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { Router, RouterLink } from '@angular/router';

interface Broker {
  id: 'upstox' | 'dhann' | 'fyers';
  name: string;
  tagline: string;
  logo: string;
}

@Component({
  selector: 'app-home-page',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './home.page.html',
})
export class HomePage {
  readonly brokers: Broker[] = [
    {
      id: 'upstox',
      name: 'Upstox',
      tagline: 'GTT Order Automation',
      logo: '/images/upstocx.png',
    },
    {
      id: 'dhann',
      name: 'Dhann',
      tagline: 'Bracket Order Automation',
      logo: '/images/dhann.jpg',
    },
    {
      id: 'fyers',
      name: 'Fyers',
      tagline: 'Bracket Order Automation',
      logo: '/images/fyers.png',
    },
  ];

  selectedBroker: Broker | null = null;

  constructor(private readonly router: Router) {}

  selectBroker(broker: Broker): void {
    this.selectedBroker = broker;
  }

  goToRegister(): void {
    if (this.selectedBroker) {
      this.router.navigate(['/register'], {
        queryParams: { broker: this.selectedBroker.id },
      });
    }
  }
}
