import { Alert, Linking } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { api } from './api';
import type { Me } from './types';

export type PhotoSource = 'camera' | 'library';

/**
 * Let the person pick or take a square photo, shrink it to 512×512 JPEG on the
 * phone, and upload it. Returns the updated profile, or null if they cancelled.
 */
export async function pickAndUploadAvatar(source: PhotoSource): Promise<Me | null> {
  const perm = source === 'camera' ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) {
    Alert.alert(
      source === 'camera' ? 'Camera access is off' : 'Photo access is off',
      `Allow Nodara to use your ${source === 'camera' ? 'camera' : 'photos'} in iOS Settings to set a profile photo.`,
      [
        { text: 'Not now', style: 'cancel' },
        { text: 'Open Settings', onPress: () => void Linking.openSettings() },
      ],
    );
    return null;
  }
  const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 1 };
  const result = source === 'camera' ? await ImagePicker.launchCameraAsync({ ...options, cameraType: ImagePicker.CameraType.front }) : await ImagePicker.launchImageLibraryAsync(options);
  if (result.canceled || !result.assets[0]) return null;
  const asset = result.assets[0];

  // Centre-crop to a square (in case the editor wasn't used), then resize.
  const side = Math.min(asset.width, asset.height);
  let ctx = ImageManipulator.manipulate(asset.uri);
  if (side > 0 && asset.width !== asset.height) {
    ctx = ctx.crop({ originX: Math.floor((asset.width - side) / 2), originY: Math.floor((asset.height - side) / 2), width: side, height: side });
  }
  ctx = ctx.resize({ width: 512, height: 512 });
  const image = await ctx.renderAsync();
  const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.82, base64: true });
  if (!saved.base64) throw new Error('Could not prepare the photo');
  return api.put<Me>('/api/me/avatar', { image: saved.base64 });
}

export const removeAvatar = () => api.del<Me>('/api/me/avatar');

/** Colours offered for initials and map markers when there's no photo (same palette as the server). */
export const AVATAR_COLORS = ['#FF7A45', '#4C9AFF', '#36B37E', '#B37FEB', '#F5A524', '#13C2C2', '#F56A9A', '#7A8CFF'];
