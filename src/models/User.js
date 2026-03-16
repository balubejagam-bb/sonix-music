import mongoose from 'mongoose';

const UserSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true, minlength: 6 },
  profileImage: { type: String, default: '' },
  likedSongs: [{ type: String }],           // song IDs
  recentlyPlayed: [{ type: String }],       // last 20 song IDs (legacy)
  recentSongObjects: [{ type: mongoose.Schema.Types.Mixed }], // full song snapshots, last 20
  library: [{ type: String }],              // saved album/playlist IDs
  playlists: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Playlist' }],
  isAdmin: { type: Boolean, default: false },
}, { timestamps: true });

export default mongoose.models.User || mongoose.model('User', UserSchema);
