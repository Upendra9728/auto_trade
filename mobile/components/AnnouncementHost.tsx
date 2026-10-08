import React, { useEffect, useState } from 'react';
import { router } from 'expo-router';
import { useAuth } from '../contexts/AuthContext';
import { useUpdate } from '../contexts/UpdateContext';
import {
  FeatureAnnouncement,
  getNextUnseenAnnouncement,
  markAnnouncementSeen,
} from '../services/announcements';
import FeatureAnnouncementModal from './FeatureAnnouncementModal';

export default function AnnouncementHost() {
  const { user } = useAuth();
  const { modalVisible: updateModalVisible } = useUpdate();
  const [activeAnnouncement, setActiveAnnouncement] = useState<FeatureAnnouncement | null>(null);
  const [modalVisible, setModalVisible] = useState(false);

  useEffect(() => {
    // Only evaluate after user is loaded, logged in, accepted legal terms, and update modal is inactive
    if (!user || user.terms_accepted === false || updateModalVisible) {
      setModalVisible(false);
      return;
    }

    let isMounted = true;
    (async () => {
      const item = await getNextUnseenAnnouncement(user.id, user.role);
      if (isMounted && item) {
        setActiveAnnouncement(item);
        setModalVisible(true);
      }
    })();

    return () => {
      isMounted = false;
    };
  }, [user?.id, user?.role, user?.terms_accepted, updateModalVisible]);

  const handleDismiss = async () => {
    if (!activeAnnouncement || !user) return;
    setModalVisible(false);
    await markAnnouncementSeen(user.id, activeAnnouncement.id);
    setActiveAnnouncement(null);
  };

  const handleCta = async () => {
    if (!activeAnnouncement || !user) return;
    const targetRoute = activeAnnouncement.ctaRoute;
    setModalVisible(false);
    await markAnnouncementSeen(user.id, activeAnnouncement.id);
    setActiveAnnouncement(null);
    if (targetRoute) {
      router.push(targetRoute as any);
    }
  };

  return (
    <FeatureAnnouncementModal
      visible={modalVisible}
      announcement={activeAnnouncement}
      onCta={handleCta}
      onDismiss={handleDismiss}
    />
  );
}
