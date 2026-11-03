export type Profile = {
  id: string;
  nickname: string;
  avatar_url: string | null;
  bio: string;
  interests: string[];
  hidden_from_search: boolean;
  hidden_from_match: boolean;
  school: string | null;
  grade: string | null;
  show_school: boolean;
  dm_privacy: 'all' | 'matches' | 'none';
  created_at: string;
  updated_at: string;
};

export type DirectMessage = {
  id: string;
  sender_id: string;
  recipient_id: string;
  body: string;
  read_at: string | null;
  deleted_at: string | null;
  created_at: string;
};

export type Group = {
  id: string;
  name: string;
  avatar_url: string | null;
  description: string;
  created_by: string;
  created_at: string;
  is_public: boolean;
};

export type GroupMember = {
  group_id: string;
  user_id: string;
  is_admin: boolean;
  joined_at: string;
};

export type GroupMessage = {
  id: string;
  group_id: string;
  sender_id: string;
  body: string;
  created_at: string;
};

export type Report = {
  id: string;
  reporter_id: string;
  reported_id: string;
  reason: string;
  status: string;
  created_at: string;
};

export const INTEREST_CATEGORIES: { key: string; label: string }[] = [
  { key: 'спорт', label: 'Спорт' },
  { key: 'игры', label: 'Игры' },
  { key: 'программирование', label: 'Программирование' },
  { key: 'музыка', label: 'Музыка' },
  { key: 'аниме', label: 'Аниме' },
  { key: 'волонтёрство', label: 'Волонтёрство' },
  { key: 'наука', label: 'Наука' },
  { key: 'книги', label: 'Книги' },
  { key: 'кино', label: 'Кино' },
  { key: 'рисование', label: 'Рисование' },
  { key: 'танцы', label: 'Танцы' },
  { key: 'фотография', label: 'Фотография' },
  { key: 'языки', label: 'Языки' },
  { key: 'путешествия', label: 'Путешествия' },
];

export const REPORT_REASONS = [
  'Спам или реклама',
  'Оскорбления или буллинг',
  'Неуместный контент',
  'Подделка профиля',
  'Другое',
];
