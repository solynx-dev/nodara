import { Text, View } from 'react-native';
import type { MemberLocation } from '@/lib/types';
import { freshness, initials } from '@/lib/format';
import { C } from '@/lib/theme';

/** Avatar pin used on the map. Out-of-date locations are greyed so they never look live. */
export function MemberMarker({ member, selected, isMe }: { member: MemberLocation; selected?: boolean; isMe?: boolean }) {
  const f = freshness(member.location?.recordedAt);
  const stale = f === 'stale' || f === 'old';
  const moving = (member.location?.speed ?? 0) > 1.2 && member.location?.heading != null && !stale;
  return (
    <View style={{ alignItems: 'center' }}>
      {moving && (
        <View
          style={{
            position: 'absolute',
            top: -8,
            width: 0,
            height: 0,
            borderLeftWidth: 6,
            borderRightWidth: 6,
            borderBottomWidth: 8,
            borderLeftColor: 'transparent',
            borderRightColor: 'transparent',
            borderBottomColor: member.avatarColor,
            transform: [{ translateY: 30 }, { rotate: `${member.location!.heading}deg` }, { translateY: -30 }],
          }}
        />
      )}
      <View
        style={{
          width: 46,
          height: 46,
          borderRadius: 23,
          backgroundColor: stale ? '#8E8E93' : member.avatarColor,
          borderWidth: 3,
          borderColor: selected ? C.accent : 'white',
          alignItems: 'center',
          justifyContent: 'center',
          shadowColor: '#000',
          shadowOpacity: 0.3,
          shadowRadius: 6,
          shadowOffset: { width: 0, height: 3 },
        }}
      >
        <Text style={{ color: 'white', fontWeight: '700', fontSize: 16 }}>{initials(member.displayName)}</Text>
      </View>
      <View style={{ width: 10, height: 10, backgroundColor: selected ? C.accent : 'white', transform: [{ rotate: '45deg' }], marginTop: -6 }} />
      {(isMe || selected) && (
        <View style={{ marginTop: 2, backgroundColor: 'rgba(0,0,0,0.65)', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 1 }}>
          <Text style={{ color: 'white', fontSize: 11, fontWeight: '700' }}>{isMe ? 'You' : member.displayName.split(' ')[0]}</Text>
        </View>
      )}
    </View>
  );
}
