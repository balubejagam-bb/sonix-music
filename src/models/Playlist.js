import mongoose from 'mongoose';

const PlaylistSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  songs: [{ type: String }],   // song IDs
  coverImage: { type: String, default: '' },
  isPublic: { type: Boolean, default: false },
}, { timestamps: true });

export default mongoose.models.Playlist || mongoose.model('Playlist', PlaylistSchema);
