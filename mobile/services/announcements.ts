import * as SecureStore from 'expo-secure-store';
import { Feather } from '@expo/vector-icons';

export interface AnnouncementBullet {
  icon: keyof typeof Feather.glyphMap;
  title: string;
  description?: string;
}

export interface FeatureAnnouncement {
  id: string;
  tag?: string;
  title: string;
  message: string;
  bullets?: AnnouncementBullet[];
  ctaText: string;
  ctaRoute?: string;
  dismissText?: string;
  enabled: boolean;
  targetRole?: 'user' | 'admin' | 'all';
}

// Registry of announcements in chronological priority order
export const ANNOUNCEMENT_REGISTRY: FeatureAnnouncement[] = [
  {
    id: 'custom-credits-v1',
    tag: 'NEW FEATURE',
    title: 'Custom Credits Are Here!',
    message: 'You can now buy the exact amount of credits you need for your trading strategy with instant in-app checkout.',
    bullets: [
      {
        icon: 'sliders',
        title: 'Choose Any Quantity',
        description: 'Pick any number from 1 to 100 credits using the new custom pack slider or presets.',
      },
      {
        icon: 'gift',
        title: '20% Bonus Credits',
        description: 'Orders above 5 credits automatically include 20% extra bonus credits free.',
      },
      {
        icon: 'shield',
        title: 'Direct In-App Checkout',
        description: 'Instant, secure payment via Razorpay right inside the app.',
      },
    ],
    ctaText: 'View Custom Plans',
    ctaRoute: '/(user)/buy-credits',
    dismissText: 'Got It',
    enabled: true,
    targetRole: 'user',
  },
];

function getStorageKey(userId: number, announcementId: string): string {
  return `announcement_seen_${userId}_${announcementId}`;
}

export async function hasSeenAnnouncement(userId: number, announcementId: string): Promise<boolean> {
  try {
    const val = await SecureStore.getItemAsync(getStorageKey(userId, announcementId));
    return val === 'true';
  } catch {
    return false;
  }
}

export async function markAnnouncementSeen(userId: number, announcementId: string): Promise<void> {
  try {
    await SecureStore.setItemAsync(getStorageKey(userId, announcementId), 'true');
  } catch {
    // Ignore storage write errors silently
  }
}

export async function getNextUnseenAnnouncement(userId: number, role?: string): Promise<FeatureAnnouncement | null> {
  for (const item of ANNOUNCEMENT_REGISTRY) {
    if (!item.enabled) continue;
    if (item.targetRole && item.targetRole !== 'all' && item.targetRole !== role) {
      continue;
    }
    const seen = await hasSeenAnnouncement(userId, item.id);
    if (!seen) {
      return item;
    }
  }
  return null;
}
