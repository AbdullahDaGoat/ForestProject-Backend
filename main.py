import json
import os

# Load the large JSON file
input_file = 'wildfire_data_5.json'
output_file_1 = 'wildfire_data_5part_1.json'
output_file_2 = 'wildfire_data_5part_2.json'

# Step 1: Load data from the original file
with open(input_file, 'r') as file:
    data = json.load(file)

# Step 2: Split the data into two parts
split_index = len(data) // 2
data_part_1 = data[:split_index]
data_part_2 = data[split_index:]

# Step 3: Write each part into separate files
with open(output_file_1, 'w') as file:
    json.dump(data_part_1, file, indent=4)

with open(output_file_2, 'w') as file:
    json.dump(data_part_2, file, indent=4)

# Get file sizes to verify split
size_1 = os.path.getsize(output_file_1) / (1024 * 1024)  # Convert bytes to MB
size_2 = os.path.getsize(output_file_2) / (1024 * 1024)  # Convert bytes to MB

print(f"✅ Split completed:")
print(f"- {output_file_1}: {size_1:.2f} MB")
print(f"- {output_file_2}: {size_2:.2f} MB")
