import streamlit as st
import pandas as pd
from sklearn.model_selection import train_test_split
from sklearn.linear_model import LinearRegression
#from sklearn.metrics import r2_score
import matplotlib.pyplot as plt
# Load data for prediction
data_constructor=pd.read_csv(r'ConstructorPrediction.csv')
comparison_df=pd.read_csv(r'regression_comparison.csv')
def predict_points(data):

    st.header('Prediction: F1 Driver Points for 2025 Season')

    # Selecting relevant features for prediction
    X = data[['driverRating', 'carRating','constructorStrategy' ,'2021_points', '2022_points', '2023_points']]
    y = data['2024_points']

    # Splitting data into training and testing sets
    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)

    # Creating and fitting the model
    model = LinearRegression()
    model.fit(X_train, y_train)
    
    # Predicting on the test set
    #predictions = model.predict(X_test)

    # Calculating mean squared error
    #mse = mean_squared_error(y_test, predictions)

    # Predicting 2024 points for all drivers
    predicted_2024_points = model.predict(X)

    # Adding predicted points to the dataframe
    data['predicted_2025_points'] = predicted_2024_points
    data['predicted_2025_points'] = data['predicted_2025_points'].round().clip(lower=0)
    data=data.sort_values(by=['predicted_2025_points'],ascending=False)

    # Displaying the results
    #st.write("Mean Squared Error:", mse)
    data_to_show = data[['driverRef','2021_points', '2022_points', '2023_points','2024_points', 'predicted_2025_points']].to_html(index=False,classes='dataframe',border=0)
    styled_html = f'<style>table.dataframe{{background-color:black; color:white; padding:10px;}}</style>{data_to_show}'
    st.write(styled_html, unsafe_allow_html=True)
    plt.figure(figsize=(10, 4),facecolor='#463F41')
    ax = plt.axes()
    ax.set_facecolor("#463F41")
    bars=plt.bar(data['driverRef'], data['predicted_2025_points'], color='#E11433')
    plt.xlabel('Driver',color='white')
    plt.ylabel('Predicted 2025 Points',color='white')
    plt.title('Predicted 2025 Points for Each Driver',color='white')
    plt.xticks(rotation=90,color='white')
    plt.yticks(color='white')
    plt.tight_layout()

    for bar in bars:
        yval = bar.get_height()
        plt.text(bar.get_x(), yval, round(yval, 2), va='bottom',color='white')
    st.pyplot(plt)
    st.markdown('<img src="https://media-cldnry.s-nbcnews.com/image/upload/t_fit-1500w,f_auto,q_auto:best/rockcms/2022-10/221010-Max-Verstappen-ew-1132a-276412.jpg" width="700" height="400"/>',unsafe_allow_html=True)

    st.write("""
    <div style="background-color: black; padding: 10px;">
        <span style="color: white;">Note: Predicting sports results are not always accurate. I have used linear regression model to predict the data with the use of last 3 years of points data, driver skill rating, car rating and constructor strategy.</span>
    </div>
    """, unsafe_allow_html=True)
#---------------------------------------------------------------------------------------
    st.write('---------------------------------------------------------------------------------------')
    st.header('Prediction: F1 Constructor Points for 2025 Season')

    data_to_show2 = data_constructor[['Constructor','2021_Points','2022_Points','2023_Points','2024_Points','Predicted_2025_Points']].to_html(index=False,classes='dataframe',border=0)
    styled_html2 = f'<style>table.dataframe{{background-color:black; color:white; padding:10px;}}</style>{data_to_show2}'
    st.write(styled_html2, unsafe_allow_html=True)
    plt.figure(figsize=(10, 4),facecolor='#463F41')
    ax = plt.axes()
    ax.set_facecolor("#463F41")
    bars=plt.bar(data_constructor['Constructor'], data_constructor['Predicted_2025_Points'], color='#E11433')
    plt.xlabel('Constructor',color='white')
    plt.ylabel('Predicted 2025 Points',color='white')
    plt.title('Predicted 2025 Points for Constructor',color='white')
    plt.xticks(rotation=90,color='white')
    plt.yticks(color='white')
    plt.tight_layout()

    for bar in bars:
        yval = bar.get_height()
        plt.text(bar.get_x()+ bar.get_width()/3, yval, round(yval, 2), va='bottom',color='white')
    
    st.pyplot(plt)
    
    st.markdown('<img src="https://media.formula1.com/content/dam/fom-website/manual/Misc/TeamByTeam2023/red-bull-tbt-2023.jpg" width="700" height="400"/>',unsafe_allow_html=True)

    st.write("""
    <div style="background-color: black; padding: 10px;">
        <span style="color: white;">Note: This data is based on drivers prediction.\n\n -- AlphaTauri is renamed as Racing Bulls.</span>
    </div>
    """, unsafe_allow_html=True)

    st.subheader('Why Linear Regression')

    data_to_show9 = comparison_df[['Model','R2 Value']].to_html(index=False, classes='dataframe',border=0)
    styled_html9 = f'<style>table.dataframe{{background-color:black; color:white; padding:10px;}}</style>{data_to_show9}'
    st.write(styled_html9, unsafe_allow_html=True)
