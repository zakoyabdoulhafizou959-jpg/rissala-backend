const express = require('express');
const cors = require('cors');

// 🔑 Initialisation Firebase Admin
const admin = require('firebase-admin');

// Charge la clé de compte de service depuis une variable d'environnement
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://liptako-commerce-default-rtdb.firebaseio.com"
});

const app = express();
app.use(cors());
app.use(express.json());

// 📥 Sauvegarde du token FCM envoyé par l'app Flutter
app.post('/api/notifications/fcm-token', async (req, res) => {
  const { token, user_id } = req.body;

  if (!token || !user_id) {
    return res.status(400).json({ success: false, error: 'Token ou user_id manquant' });
  }

  try {
    // Sauvegarde le token dans Realtime Database : /users/{user_id}/fcmToken
    await admin.database().ref(`users/${user_id}/fcmToken`).set(token);
    console.log(`✅ Token FCM sauvegardé pour user ${user_id}`);
    res.status(200).json({ success: true });
  } catch (error) {
    console.error('❌ Erreur sauvegarde token:', error);
    res.status(500).json({ success: false, error: 'Erreur serveur' });
  }
});

// 🔔 Fonction utilitaire pour envoyer une notification
async function sendPushNotification(fcmToken, title, body, data = {}) {
  try {
    const message = {
      token: fcmToken,
      notification: { title, body },
       { ...data, click_action: 'FLUTTER_NOTIFICATION_CLICK' },
      android: {
        notification: {
          channelId: 'rissala_channel',
          sound: 'default'
        }
      },
      apns: {
        payload: {
          aps: { sound: 'default' }
        }
      }
    };

    const response = await admin.messaging().send(message);
    console.log('📤 Notification envoyée:', response);
    return true;
  } catch (error) {
    console.error('❌ Échec envoi notification:', error.message);
    return false;
  }
}

// 📦 Endpoint : publication d’un produit → notifie tous les autres utilisateurs
app.post('/api/products', async (req, res) => {
  const { title, sellerId } = req.body;

  if (!title || !sellerId) {
    return res.status(400).json({ success: false, error: 'Titre ou vendeur manquant' });
  }

  // Récupère tous les utilisateurs
  const usersSnapshot = await admin.database().ref('users').once('value');
  const users = usersSnapshot.val() || {};

  // Envoie une notification à chaque utilisateur (sauf le vendeur)
  for (const [userId, userData] of Object.entries(users)) {
    if (userId !== sellerId && userData.fcmToken) {
      await sendPushNotification(
        userData.fcmToken,
        '📦 Nouveau produit disponible !',
        `Découvrez : ${title}`,
        { type: 'nouveau_produit', relatedId: Date.now().toString() }
      );
    }
  }

  res.status(200).json({ success: true, message: 'Produit publié' });
});

// 📥 Endpoint : nouvelle demande → notifie le vendeur
app.post('/api/demands', async (req, res) => {
  const { productId, sellerId, buyerName } = req.body;

  if (!productId || !sellerId) {
    return res.status(400).json({ success: false, error: 'Données manquantes' });
  }

  const sellerRef = admin.database().ref(`users/${sellerId}`);
  const sellerSnapshot = await sellerRef.once('value');
  const seller = sellerSnapshot.val();

  if (seller && seller.fcmToken) {
    await sendPushNotification(
      seller.fcmToken,
      '📥 Nouvelle demande de produit',
      `${buyerName} souhaite acheter votre produit.`,
      { type: 'nouvelle_demande', relatedId: productId }
    );
  }

  res.status(200).json({ success: true });
});

// 💬 Endpoint : nouveau message → notifie le destinataire
app.post('/api/messages', async (req, res) => {
  const { senderName, receiverId, content } = req.body;

  if (!receiverId || !content) {
    return res.status(400).json({ success: false, error: 'Destinataire ou message manquant' });
  }

  const receiverRef = admin.database().ref(`users/${receiverId}`);
  const receiverSnapshot = await receiverRef.once('value');
  const receiver = receiverSnapshot.val();

  if (receiver && receiver.fcmToken) {
    await sendPushNotification(
      receiver.fcmToken,
      '💬 Nouveau message',
      `De ${senderName}: ${content.substring(0, 30)}${content.length > 30 ? '...' : ''}`,
      { type: 'nouveau_message', relatedId: receiverId }
    );
  }

  res.status(200).json({ success: true });
});

// 🌐 Démarrage du serveur
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Serveur Rissala démarré sur le port ${PORT}`);
});